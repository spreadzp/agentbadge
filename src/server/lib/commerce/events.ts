/**
 * SLICE-224-2 (EPIC-224): append-only CommerceEvent emitter with a
 * per-entity SHA-256 hash chain (D-224-7, slice spec "prevHash→hash per
 * entity stream").
 *
 * prevHash = hash of the previous event on the SAME (entityType, entityId)
 * stream; the first event carries GENESIS_HASH. Emits are serialized per
 * service instance through a promise queue so concurrent transitions on
 * one entity can't fork the chain (read-then-append race).
 */
import type {
  CommerceEventRow,
  CommerceEventStore,
} from "@agentbadge/database";
import type { JsonValue } from "@prisma/orm-postgres/target/codec-types";

import { GENESIS_HASH, hashEvent } from "./state-machines";
import { newId } from "./guards";

export interface EmitInput {
  entityType: string;
  entityId: string;
  eventType: string;
  actorWallet?: string | null;
  payload?: JsonValue;
}

export class CommerceEventEmitter {
  /** Serializes appends — one in-flight emit per service instance. */
  private tail: Promise<unknown> = Promise.resolve();

  constructor(private readonly events: CommerceEventStore) {}

  emit(input: EmitInput): Promise<CommerceEventRow> {
    const run = this.tail.then(() => this.append(input));
    this.tail = run.catch(() => {});
    return run;
  }

  private async append(input: EmitInput): Promise<CommerceEventRow> {
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
      id: newId("evt"),
      entityType: input.entityType,
      entityId: input.entityId,
      eventType: input.eventType,
      actorWallet: input.actorWallet ?? null,
      prevHash,
      hash,
      payload,
    });
    if (!row) {
      // id collision — effectively impossible (uuid), fail loudly
      throw new Error(`commerce event id collision on ${input.entityType}`);
    }
    return row;
  }
}
