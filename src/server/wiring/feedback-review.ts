/**
 * EPIC-230 (SLICE-230-4): domain wiring — mounts the feedback/review
 * public API surfaces. The TG-notify hooks land here in 230-7 riding
 * the post-commit event seams (agent-interaction wiring precedent).
 */

import type { Hono } from "hono";

import { getDatabase } from "../lib/database";
import { pickFeedbackStore } from "../lib/feedback/db-stores";
import { pickReviewStore } from "../lib/reviews/db-stores";
import { mountFeedbackReviewRoutes } from "../routes/feedback-review/mount";

export function wireFeedbackReview(app: Hono): void {
  const db = getDatabase();
  mountFeedbackReviewRoutes(app, {
    feedback: pickFeedbackStore(db),
    reviews: pickReviewStore(db),
  });
}
