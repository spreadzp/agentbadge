/**
 * EPIC-230 (SLICE-230-2, D-230-1): feedback domain events.
 *
 * Same two-path guarantee as interaction (events.ts precedent):
 *  1. Same-tx appends travel INSIDE the store composite calls
 *     (submitFeedback/transitionFeedback take event args);
 *     `buildFeedbackEvent` only BUILDS those objects.
 *  2. `onFeedbackEvent` hooks fire AFTER commit, fire-and-forget —
 *     the SLICE-230-7 TG notify plugs in here without touching the
 *     write path (a hook failure must never break a transition).
 */

import { randomUUID } from "node:crypto";

import { logger } from "@agentbadge/passport/logger";

import type { EventVisibility, FeedbackEventKind } from "./types";
import type { FeedbackEventInput } from "./store";

export function buildFeedbackEvent(
  kind: FeedbackEventKind | string,
  visibility: EventVisibility,
  payload: unknown,
): FeedbackEventInput {
  return { id: `fev_${randomUUID()}`, kind, visibility, payload };
}

type FeedbackEventHook = (
  feedbackId: string,
  event: FeedbackEventInput,
) => void | Promise<void>;

const hooks: FeedbackEventHook[] = [];

/** Wiring seam (230-7 TG notify). Returns an unsubscribe fn. */
export function onFeedbackEvent(fn: FeedbackEventHook): () => void {
  hooks.push(fn);
  return () => {
    const i = hooks.indexOf(fn);
    if (i >= 0) hooks.splice(i, 1);
  };
}

export function emitFeedbackHooks(
  feedbackId: string,
  events: FeedbackEventInput[],
): void {
  for (const ev of events) {
    for (const fn of hooks) {
      try {
        const r = fn(feedbackId, ev);
        if (r instanceof Promise) {
          r.catch((err) =>
            logger.warn("feedback: event hook failed", {
              feedbackId,
              kind: ev.kind,
              err: err instanceof Error ? err.message : String(err),
            }),
          );
        }
      } catch (err) {
        logger.warn("feedback: event hook threw", {
          feedbackId,
          kind: ev.kind,
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }
}
