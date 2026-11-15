/**
 * Shared service context: the CommerceStores bundle + the hash-chain
 * emitter. Every domain service factory takes this — wiring lives in
 * ../index.ts (createCommerceService).
 */
import type { CommerceStores } from "@agentbadge/database";
import type { JsonValue } from "@prisma/orm-postgres/target/codec-types";

import type { CommerceEventEmitter } from "../events";
import type { CommerceEntityType } from "../types";
import { CommerceError, invalidTransition } from "../types";
import { assertTransition } from "../state-machines";

export interface CommerceCtx {
  stores: CommerceStores;
  emit: CommerceEventEmitter;
}

export interface TransitionOpts {
  actorWallet?: string | null;
  /** Extra fields merged into the event payload (must be JsonValue-safe). */
  payload?: Record<string, JsonValue>;
}

/**
 * Legality check (domain table) → guarded store write (serializes
 * concurrent writers). `applyStatus` returning null means a stale row —
 * surfaced as INVALID_TRANSITION, never silently retried.
 *
 * Event type is derived: task.IN_PROGRESS → `task.in_progress`.
 */
export async function transitionRow<TRow>(
  ctx: CommerceCtx,
  entity: CommerceEntityType,
  row: { id: string; status: string },
  to: string,
  apply: (expectedFrom: string) => Promise<TRow | null>,
  opts?: TransitionOpts,
): Promise<TRow> {
  assertTransition(entity, row.status, to);
  const updated = await apply(row.status);
  if (!updated) {
    // row moved under us — report the attempted edge as invalid
    throw invalidTransition(entity, row.status, to);
  }
  await ctx.emit.emit({
    entityType: entity,
    entityId: row.id,
    eventType: `${entity}.${eventVerb(to)}`,
    actorWallet: opts?.actorWallet ?? null,
    payload: {
      from: row.status,
      to,
      ...(opts?.payload ?? {}),
    },
  });
  return updated;
}

/** Status → past-tense event verb (statuses are already adjectives except OPEN). */
const EVENT_VERBS: Record<string, string> = {
  OPEN: "opened",
  PAYMENT_RECORDED: "recorded",
  PAYMENT_VERIFIED: "verified",
};

function eventVerb(status: string): string {
  return EVENT_VERBS[status] ?? status.toLowerCase();
}

export function mustGet<TRow>(
  row: TRow | null,
  what: string,
  id: string,
): TRow {
  if (!row) {
    throw new CommerceError("NOT_FOUND", `${what} ${id} not found`, 404);
  }
  return row;
}
