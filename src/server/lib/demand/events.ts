/**
 * EPIC-231 (SLICE-231-2, D-231-1 + EPIC-207): demand domain events.
 *
 * Same two-path guarantee as feedback (events.ts precedent):
 *  1. Same-tx appends travel INSIDE store composite calls
 *     (recordSignal / transition / applyClusterLevel take event args);
 *     `buildDemandEvent` only BUILDS those objects.
 *  2. `onDemandEvent` hooks fire AFTER commit, fire-and-forget —
 *     notification seams plug in without touching the write path.
 */

import { randomUUID } from "node:crypto";

import { logger } from "@agentbadge/passport/logger";

import type { DemandEventInput } from "./store";

export function buildDemandEvent(
  kind: string,
  visibility: "PUBLIC" | "INTERNAL",
  payload: unknown,
  idempotencyKey?: string,
): DemandEventInput {
  return {
    id: `dev_${randomUUID()}`,
    kind,
    visibility,
    payload,
    idempotencyKey: idempotencyKey ?? null,
  };
}

type DemandEventHook = (
  entityType: string,
  entityId: string,
  event: DemandEventInput,
) => void | Promise<void>;

const hooks: DemandEventHook[] = [];

/** Wiring seam (notifications, metrics). Returns an unsubscribe fn. */
export function onDemandEvent(fn: DemandEventHook): () => void {
  hooks.push(fn);
  return () => {
    const i = hooks.indexOf(fn);
    if (i >= 0) hooks.splice(i, 1);
  };
}

/** Fire-and-forget fan-out AFTER commit — a hook failure must never
 *  break a write (feedback precedent). */
export function emitDemandHooks(
  entityType: string,
  entityId: string,
  events: DemandEventInput[],
): void {
  for (const e of events) {
    for (const fn of hooks) {
      try {
        const r = fn(entityType, entityId, e);
        if (r instanceof Promise) {
          r.catch((err) =>
            logger.warn("demand: event hook failed", {
              entityId,
              kind: e.kind,
              err: err instanceof Error ? err.message : String(err),
            }),
          );
        }
      } catch (err) {
        logger.warn("demand: event hook threw", {
          entityId,
          kind: e.kind,
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }
}
