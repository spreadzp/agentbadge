/**
 * EPIC-227 / SLICE-227-2 — append-only settlement event emitter with a
 * per-entity SHA-256 hash chain (SLICE-224-2 pattern, D-227 parity).
 *
 * prevHash = hash of the previous event on the SAME (entityType,
 * entityId) stream; the first event carries GENESIS_HASH. Emits are
 * serialized per emitter instance through a promise queue so
 * concurrent transitions on one entity can't fork the chain.
 *
 * Rows land in the shared generic event store (`db.commerce.events`)
 * under settlement-namespaced entity types — the table is generic
 * (entityType is a free string), no commerce-domain import required.
 */
import type {
  CommerceEventRow,
  CommerceEventStore,
} from "@agentbadge/database";
import type { JsonValue } from "@prisma/orm-postgres/target/codec-types";

import { logger } from "@agentbadge/passport/logger";

import { GENESIS_HASH, hashEvent } from "./state-machines.js";
import type { SettlementEntityType } from "./types.js";

export interface SettlementEmitInput {
  entityType: SettlementEntityType;
  entityId: string;
  eventType: string;
  actorWallet?: string | null;
  payload?: JsonValue;
}

/**
 * M-2: events describe COMMITTED state — emit() inside an atomic
 * section writes straight through (the emitter doesn't join the tx),
 * so a rollback would leave phantom events in the append-only chain.
 * `buffer()` queues inputs in memory; `flush()` emits them through
 * the serialized queue AFTER the atomic resolves.
 */
export interface SettlementEmitBuffer {
  emit(input: SettlementEmitInput): void;
  flush(): Promise<void>;
}

const newEventId = (): string => `evt_${crypto.randomUUID()}`;

export class SettlementEventEmitter {
  /** Serializes appends — one in-flight emit per service instance. */
  private tail: Promise<unknown> = Promise.resolve();

  /** R6-M4: entity keys whose last append timed out. The underlying
   *  store call may still complete — its promise is kept here so the
   *  NEXT emit on the same stream awaits it before re-reading
   *  prevHash. Skipping this would fork the hash chain: both rows
   *  would carry the same prevHash with no uniqueness to catch it. */
  private readonly stale = new Map<string, Promise<unknown>>();

  /** R7-M3: streams whose stale append outlived its grace window —
   *  emits on them are skipped (logged once at poison time) so a
   *  dead store call can never stall the shared queue. */
  private readonly poisoned = new Set<string>();

  constructor(private readonly events: CommerceEventStore) {}

  /** Queue events for post-commit emit (M-2). On flush each input
   *  runs through the serialized append path in call order. */
  buffer(): SettlementEmitBuffer {
    const queue: SettlementEmitInput[] = [];
    return {
      emit: (input) => void queue.push(input),
      flush: async () => {
        for (const input of queue.splice(0)) await this.emit(input);
      },
    };
  }

  /** Best-effort emit: a store outage must not fail the transition the
   *  event describes (the row itself is the state of record). R5 nit:
   *  a hung store call would stall the shared serialized queue —
   *  bound each append with a timeout. R6-M4: a timed-out append can
   *  STILL land later, so its entity stream is poisoned — the next
   *  emit on the same stream awaits the stale append first instead
   *  of forking the hash chain on a stale prevHash read. Failures
   *  and timeouts are logged at error level (invisible loss is how
   *  audit trails die), and the timer is always cleared. */
  emit(input: SettlementEmitInput): Promise<CommerceEventRow | null> {
    const key = `${input.entityType}:${input.entityId}`;
    const run = this.tail.then(async () => {
      if (this.poisoned.has(key)) return null;
      const pendingStale = this.stale.get(key);
      if (pendingStale) {
        this.stale.delete(key);
        // R7-M3: bound the wait — after one grace window the stream
        // is poisoned and emits skip, so a hung store call can't
        // stall the shared queue (or the caller past its commit).
        let staleTimer: ReturnType<typeof setTimeout> | undefined;
        const settled = await Promise.race([
          pendingStale.then(() => true, () => true),
          new Promise<false>((res) => {
            staleTimer = setTimeout(() => res(false), 15000);
          }),
        ]);
        if (staleTimer) clearTimeout(staleTimer);
        if (!settled) {
          this.poisoned.add(key);
          logger.error("settlement event stream poisoned — emits skipped", {
            entityType: input.entityType,
            entityId: input.entityId,
          });
          return null;
        }
      }
      let timer: ReturnType<typeof setTimeout> | undefined;
      const appending = this.append(input);
      try {
        return await Promise.race<CommerceEventRow>([
          appending,
          new Promise<CommerceEventRow>((_, reject) => {
            timer = setTimeout(
              () => reject(new Error("settlement event append timeout")),
              15000,
            );
          }),
        ]);
      } catch (err) {
        logger.error("settlement event emit failed", {
          entityType: input.entityType,
          entityId: input.entityId,
          eventType: input.eventType,
          error: err instanceof Error ? err.message : String(err),
        });
        // Keep the in-flight append — the next emit on this stream
        // must see its row (or its failure) before hashing again.
        this.stale.set(key, appending);
        return null;
      } finally {
        if (timer) clearTimeout(timer);
      }
    });
    this.tail = run;
    return run;
  }

  private async append(
    input: SettlementEmitInput,
  ): Promise<CommerceEventRow> {
    const stream = await this.events.listByEntity(
      input.entityType,
      input.entityId,
    );
    const prevHash = stream.length
      ? stream[stream.length - 1]!.hash
      : GENESIS_HASH;
    const payload = input.payload ?? {};
    const hash = hashEvent({
      prevHash,
      entityType: input.entityType,
      entityId: input.entityId,
      eventType: input.eventType,
      actorWallet: input.actorWallet ?? null,
      payload,
    });
    const row = await this.events.append({
      id: newEventId(),
      entityType: input.entityType,
      entityId: input.entityId,
      eventType: input.eventType,
      actorWallet: input.actorWallet ?? null,
      prevHash,
      hash,
      payload,
    });
    if (!row) {
      throw new Error(
        `settlement event id collision on ${input.entityType}`,
      );
    }
    return row;
  }
}

/** Convenience singleton factory — one emitter per service ctx. */
export function createSettlementEmitter(
  events: CommerceEventStore,
): SettlementEventEmitter {
  return new SettlementEventEmitter(events);
}
