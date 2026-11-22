/**
 * EPIC-230 (SLICE-230-4): domain wiring — mounts the feedback/review
 * public API surfaces. The TG-notify hooks land here in 230-7 riding
 * the post-commit event seams (agent-interaction wiring precedent).
 */

import type { Hono } from "hono";

import { getDatabase } from "../lib/database";
import { pickFeedbackStore } from "../lib/feedback/db-stores";
import { pickReviewStore } from "../lib/reviews/db-stores";
import { pickKnowledgeStores } from "../lib/knowledge/db-stores";
import { knowledgeDraftPort } from "../lib/knowledge-draft/port";
import { mountFeedbackReviewRoutes } from "../routes/feedback-review/mount";

export function wireFeedbackReview(app: Hono): void {
  const db = getDatabase();
  mountFeedbackReviewRoutes(app, {
    feedback: pickFeedbackStore(db),
    reviews: pickReviewStore(db),
    // D-230-10: real adapter over the shipped 229 service — in memory
    // mode pickKnowledgeStores returns the singleton memory store, so
    // the draft lands in the same seam the admin knowledge UI reads.
    draftPort: knowledgeDraftPort(pickKnowledgeStores(db)),
  });
}
