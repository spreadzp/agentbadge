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

import { GENESIS_HASH, hashEvent } from "./state-machines.js";
import type { SettlementEntityType } from "./types.js";

export interface SettlementEmitInput {
  entityType: SettlementEntityType;
  entityId: string;
  eventType: string;
  actorWallet?: string | null;
  payload?: JsonValue;
}

const newEventId = (): string => `evt_${crypto.randomUUID()}`;

export class SettlementEventEmitter {
  /** Serializes appends — one in-flight emit per service instance. */
  private tail: Promise<unknown> = Promise.resolve();

  constructor(private readonly events: CommerceEventStore) {}

  /** Best-effort emit: a store outage must not fail the transition the
   *  event describes (the row itself is the state of record). */
  emit(input: SettlementEmitInput): Promise<CommerceEventRow | null> {
    const run = this.tail
      .then(() => this.append(input))
      .catch(() => null);
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
