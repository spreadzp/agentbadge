/**
 * EPIC-230 (SLICE-230-3, D-230-1): review domain events — same
 * two-path guarantee as feedback/events.ts (same-tx appends inside
 * store composites; post-commit hook fan-out for 230-7 TG notify).
 */

import { randomUUID } from "node:crypto";

import { logger } from "@agentbadge/passport/logger";

import type { ReviewEventInput } from "./store";

export function buildReviewEvent(
  kind: string,
  visibility: "PUBLIC" | "INTERNAL",
  payload: unknown,
): ReviewEventInput {
  return { id: `rev_${randomUUID()}`, kind, visibility, payload };
}

type ReviewEventHook = (
  reviewId: string,
  event: ReviewEventInput,
) => void | Promise<void>;

const hooks: ReviewEventHook[] = [];

/** Wiring seam (230-7 TG notify). Returns an unsubscribe fn. */
export function onReviewEvent(fn: ReviewEventHook): () => void {
  hooks.push(fn);
  return () => {
    const i = hooks.indexOf(fn);
    if (i >= 0) hooks.splice(i, 1);
  };
}

export function emitReviewHooks(
  reviewId: string,
  events: ReviewEventInput[],
): void {
  for (const ev of events) {
    for (const fn of hooks) {
      try {
        const r = fn(reviewId, ev);
        if (r instanceof Promise) {
          r.catch((err) =>
            logger.warn("reviews: event hook failed", {
              reviewId,
              kind: ev.kind,
              err: err instanceof Error ? err.message : String(err),
            }),
          );
        }
      } catch (err) {
        logger.warn("reviews: event hook threw", {
          reviewId,
          kind: ev.kind,
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }
}
