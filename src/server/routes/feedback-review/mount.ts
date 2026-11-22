/**
 * EPIC-230: mount the feedback/review public surfaces — the admin
 * Review Center (230-5) and admin JSON API bolt on here later
 * (agent-interaction/mount.ts precedent).
 */

import type { Hono } from "hono";

import type { FeedbackStore } from "../../lib/feedback/store";
import type { ReviewStore } from "../../lib/reviews/store";
import { createAgentFeedbackRoutes } from "./agent-feedback-api";
import { createAgentReviewsRoutes } from "./agent-reviews-api";
import { createReviewCenter } from "./review-center";

export interface FeedbackReviewStores {
  feedback: FeedbackStore;
  reviews: ReviewStore;
}

export function mountFeedbackReviewRoutes(
  app: Hono,
  stores: FeedbackReviewStores,
): void {
  // 230-4: public — POST/GET /api/v1/agent/feedback|reviews.
  app.route("/", createAgentFeedbackRoutes({ store: stores.feedback }));
  app.route("/", createAgentReviewsRoutes({ store: stores.reviews }));
  // 230-5: operator SSR — /admin/review-center?queue= behind adminBrowserAuth.
  app.route("/", createReviewCenter({ stores }));
}
