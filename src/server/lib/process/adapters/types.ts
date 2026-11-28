/**
 * SLICE-236-3 (D-236-Q1): adapter registry types.
 *
 * Minimal mirror of the econ-events/1 surface an adapter consumes —
 * reading the ledger never requires the econ-events package import:
 * the event's own fields are structural. Only fields the adapter
 * actually reads are declared.
 */
import type { ProcessEventProjection } from "../projections/types";

/** Minimal participant-role shape riding payload.roles (D-212-3). */
export interface ParticipantRoleLike {
  address: string;
  type?: string;
  label?: string;
}

/** Minimal ledger event shape — superset of every emit path. */
export interface EconomicEventLike {
  source: string;
  sourceId: string;
  seq: number;
  kind: string;
  actor: string;
  counterparty?: string;
  amountUsdc?: string;
  at?: string;
  /** `ev:{source}:{sourceId}:{seq}` — used as sourceEvent.id. */
  idempotencyKey?: string;
  payload?: Record<string, unknown>;
}

/**
 * Domain adapter (D-236-Q1): `handles` scopes by source/kind,
 * `project` returns a valid projection — UNSUPPORTED+TYPE_UNKNOWN
 * for kinds it does not map, never a throw into the read path
 * (adapter failure must not block the ledger).
 */
export interface ProcessAdapter {
  /** mapping.adapter — kebab id ("supply-chain"). */
  readonly id: string;
  /** mapping.version — semver. */
  readonly version: string;
  handles(event: EconomicEventLike): boolean;
  project(event: EconomicEventLike): Promise<ProcessEventProjection>;
}
