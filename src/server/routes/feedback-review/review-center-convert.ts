/**
 * EPIC-230 (SLICE-230-5/6, D-230-10): Review Center knowledge-draft
 * conversion POSTs — split from review-center-mutations per the
 * 300-line cap.
 *
 * Arc 230-8 H2: every convert call is wrapped — a store/port failure
 * surfaces as the generic flash code, never a bare 500.
 */

import type { Hono } from "hono";

import {
  convertFeedbackToDraft,
  convertReviewToDraft,
} from "../../lib/knowledge-draft/convert";
import { unavailableDraftPort } from "../../lib/knowledge-draft/port";
import { feedbackIdSchema } from "../../lib/feedback/validate";
import { reviewIdSchema } from "../../lib/reviews/validate";
import type { FeedbackReviewStores } from "./mount";
import { backTo, guardMutation } from "./review-center-shared";

export function registerReviewCenterConversions(
  app: Hono,
  stores: FeedbackReviewStores,
): void {
  app.post("/admin/review-center/feedback/:id/convert", async (c) => {
    const g = await guardMutation(c, "feedback", c.req.param("id"), feedbackIdSchema);
    if (!g.ok) return g.res;
    const r = await convertFeedbackToDraft(
      stores.feedback,
      stores.draftPort ?? unavailableDraftPort(),
      g.id,
      g.operator,
    ).catch((err) => {
      console.error("review-center: feedback convert failed", {
        id: g.id,
        err: err instanceof Error ? err.message : String(err),
      });
      return { ok: false as const, error: "operation_failed" };
    });
    return c.redirect(
      backTo(
        "feedback",
        g.id,
        r.ok ? { ok: "converted" } : { err: r.error },
      ),
      303,
    );
  });

  app.post("/admin/review-center/reviews/:id/convert", async (c) => {
    const g = await guardMutation(c, "reviews", c.req.param("id"), reviewIdSchema);
    if (!g.ok) return g.res;
    const r = await convertReviewToDraft(
      stores.reviews,
      stores.draftPort ?? unavailableDraftPort(),
      g.id,
      g.operator,
    ).catch((err) => {
      console.error("review-center: review convert failed", {
        id: g.id,
        err: err instanceof Error ? err.message : String(err),
      });
      return { ok: false as const, error: "operation_failed" };
    });
    return c.redirect(
      backTo(
        "reviews",
        g.id,
        r.ok ? { ok: "converted" } : { err: r.error },
      ),
      303,
    );
  });
}
