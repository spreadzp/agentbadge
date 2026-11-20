/**
 * EPIC-228 (SLICE-228-2, D-228-4): interaction event emission.
 *
 * Two paths, one guarantee — an event exists iff its state-change
 * committed:
 *  1. Same-tx appends travel INSIDE the store composite calls
 *     (submitInteraction/classify/respond/reject take an events[] arg);
 *     helpers below just BUILD those event objects.
 *  2. `recordEvent` is the standalone append for post-commit events
 *     that have no state mutation (REVIEW_REQUIRED fan-out etc.).
 *
 * `onInteractionEvent` hooks fire AFTER commit, fire-and-forget —
 * the SLICE-228-6 TG-notify plugs in here without touching the
 * write path (econ-ledger/emit.ts precedent: a hook failure must
 * never break the business transition).
 */

import { randomUUID } from "node:crypto";

import { logger } from "@agentbadge/passport/logger";
import type {
  InteractionEventKind,
  InteractionEventRecord,
  EventVisibility,
} from "../request-inbox/interaction-types";
import type { InteractionEventInput } from "../request-inbox/interaction-store";
import type { RequestInboxStores } from "../request-inbox/store";

export function buildEvent(
  kind: InteractionEventKind | string,
  visibility: EventVisibility,
  payload: unknown,
): InteractionEventInput {
  return { id: `iev_${randomUUID()}`, kind, visibility, payload };
}

/** Post-commit listeners — sync or async; errors are logged+swallowed. */
type InteractionEventHook = (
  requestId: string,
  event: InteractionEventInput,
) => void | Promise<void>;

const hooks: InteractionEventHook[] = [];

/** Wiring seam (228-6 TG-notify). Returns an unsubscribe fn. */
export function onInteractionEvent(fn: InteractionEventHook): () => void {
  hooks.push(fn);
  return () => {
    const i = hooks.indexOf(fn);
    if (i >= 0) hooks.splice(i, 1);
  };
}

export function emitInteractionHooks(
  requestId: string,
  events: InteractionEventInput[],
): void {
  for (const ev of events) {
    for (const fn of hooks) {
      try {
        const r = fn(requestId, ev);
        if (r instanceof Promise) {
          r.catch((err) =>
            logger.warn("agent-interaction: event hook failed", {
              requestId,
              kind: ev.kind,
              err: err instanceof Error ? err.message : String(err),
            }),
          );
        }
      } catch (err) {
        logger.warn("agent-interaction: event hook threw", {
          requestId,
          kind: ev.kind,
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }
}

/** Standalone append + hook fan-out after the store commits. */
export async function recordEvent(
  stores: RequestInboxStores,
  requestId: string,
  event: InteractionEventInput,
): Promise<InteractionEventRecord> {
  const [rec] = await stores.interactions.appendEvents(requestId, [event]);
  emitInteractionHooks(requestId, [event]);
  return rec;
}
