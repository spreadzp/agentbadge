/**
 * EPIC-230 (SLICE-230-5, D-230-11): Review Center form mutations —
 * form-encoded PRG back to the detail page.
 *
 * Guards on every POST (Arc lessons 5-7):
 *  - single-use formToken consumed at the edge (double-submit/F5 →
 *    honest "expired" flash, the domain write never runs twice)
 *  - operator ref → credential principal.id (264-8)
 *  - flash values are whitelist codes via backTo(), never free text
 */

import type { Hono } from "hono";

import {
  closeFeedback,
  resolveFeedback,
  triageFeedback,
} from "../../lib/feedback/workflow";
import {
  claimReview,
  declineReview,
  rejectAiSuggestion,
  reopenReview,
  returnToTriage,
} from "../../lib/reviews/workflow";
import { decideReview } from "../../lib/reviews/decide";
import type { AiStore } from "../../lib/ai/types";
import { addReviewEvidence } from "../../lib/reviews/evidence";
import { criteriaForReview } from "../../lib/reviews/criteria";
import { feedbackIdSchema } from "../../lib/feedback/validate";
import { reviewIdSchema } from "../../lib/reviews/validate";
import type { FeedbackReviewStores } from "./mount";
import {
  backTo,
  badId,
  clipCp,
  formStr,
  guardMutation,
} from "./review-center-shared";

export function registerReviewCenterMutations(
  app: Hono,
  stores: FeedbackReviewStores,
  /** 232-12 C-1: run-ref validation needs the ai store — absent,
   *  aiRunRef/reject-suggestion inputs are refused, never trusted. */
  aiStore?: AiStore,
): void {
  // ── feedback ────────────────────────────────────────────────

  app.post("/admin/review-center/feedback/:id/triage", async (c) => {
    const g = await guardMutation(c, "feedback", c.req.param("id"), feedbackIdSchema);
    if (!g.ok) return g.res;
    const patch: Record<string, unknown> = {};
    for (const k of ["kind", "target", "severity", "suggestion"] as const) {
      const v = formStr(g.body, k);
      if (v !== "") patch[k] = v;
    }
    const r = await triageFeedback(
      stores.feedback,
      g.id,
      patch,
      g.operator,
    );
    return c.redirect(
      backTo("feedback", g.id, r.ok ? { ok: "triaged" } : { err: r.error }),
      303,
    );
  });

  app.post("/admin/review-center/feedback/:id/resolve", async (c) => {
    const g = await guardMutation(c, "feedback", c.req.param("id"), feedbackIdSchema);
    if (!g.ok) return g.res;
    const to = formStr(g.body, "to");
    if (to !== "ACCEPTED" && to !== "DECLINED" && to !== "DUPLICATE") {
      return c.redirect(
        backTo("feedback", g.id, { err: "invalid_patch" }),
        303,
      );
    }
    const suggestion = formStr(g.body, "suggestion");
    const r = await resolveFeedback(stores.feedback, g.id, to, g.operator, {
      // Arc 230-8 nit: the form pre-fills the current value, so a
      // blank submission is a deliberate CLEAR, not "leave as is".
      suggestion: suggestion === "" ? null : suggestion,
    });
    return c.redirect(
      backTo("feedback", g.id, r.ok ? { ok: "resolved" } : { err: r.error }),
      303,
    );
  });

  app.post("/admin/review-center/feedback/:id/close", async (c) => {
    const g = await guardMutation(c, "feedback", c.req.param("id"), feedbackIdSchema);
    if (!g.ok) return g.res;
    const r = await closeFeedback(stores.feedback, g.id, g.operator, {
      from: formStr(g.body, "fromStatus") || undefined,
    });
    return c.redirect(
      backTo("feedback", g.id, r.ok ? { ok: "closed" } : { err: r.error }),
      303,
    );
  });

  // ── reviews ─────────────────────────────────────────────────

  app.post("/admin/review-center/reviews/:id/claim", async (c) => {
    const g = await guardMutation(c, "reviews", c.req.param("id"), reviewIdSchema);
    if (!g.ok) return g.res;
    const r = await claimReview(stores.reviews, g.id, g.operator);
    return c.redirect(
      backTo("reviews", g.id, r.ok ? { ok: "claimed" } : { err: r.error }),
      303,
    );
  });

  // 232-9 E9 / 232-12 C-1: operator dismisses the suggestion —
  // the rejection lands as ONE deduped INTERNAL event through the
  // workflow facade (claimed case, assignee, verified run ref —
  // junk rejections can't corrupt the metrics).
  app.post(
    "/admin/review-center/reviews/:id/reject-suggestion",
    async (c) => {
      const g = await guardMutation(
        c,
        "reviews",
        c.req.param("id"),
        reviewIdSchema,
      );
      if (!g.ok) return g.res;
      const runRef = formStr(g.body, "aiRunRef");
      if (!runRef || !aiStore) {
        return c.redirect(
          backTo("reviews", g.id, {
            err: !aiStore ? "ai_unavailable" : "missing_run_ref",
          }),
          303,
        );
      }
      const r = await rejectAiSuggestion(
        stores.reviews,
        aiStore,
        g.id,
        g.operator,
        {
          runId: runRef.slice(0, 128),
          reason: clipCp(formStr(g.body, "reason"), 200) || null,
        },
      );
      return c.redirect(
        backTo(
          "reviews",
          g.id,
          r.ok ? { ok: "suggestion_rejected" } : { err: r.error },
        ),
        303,
      );
    },
  );

  app.post("/admin/review-center/reviews/:id/decline", async (c) => {
    const g = await guardMutation(c, "reviews", c.req.param("id"), reviewIdSchema);
    if (!g.ok) return g.res;
    const note = formStr(g.body, "reason");
    const r = await declineReview(
      stores.reviews,
      g.id,
      formStr(g.body, "declineReason"),
      g.operator,
      {
        reason: note === "" ? null : clipCp(note, 300),
        from: formStr(g.body, "fromStatus") || undefined,
      },
    );
    return c.redirect(
      backTo("reviews", g.id, r.ok ? { ok: "declined" } : { err: r.error }),
      303,
    );
  });

  app.post("/admin/review-center/reviews/:id/decide", async (c) => {
    const g = await guardMutation(c, "reviews", c.req.param("id"), reviewIdSchema);
    if (!g.ok) return g.res;
    const rec = await stores.reviews.getReview(g.id);
    if (!rec) return badId();
    // Rebuild criteriaResults from the rendered template fields —
    // crit_<key> + note_<key>. Unset fields are skipped (→ the domain
    // reports missing_criteria); keys are re-validated against the
    // template, so a forged key can't pass.
    const criteriaResults = criteriaForReview(rec.reviewType).flatMap(
      (tpl) => {
        const result = formStr(g.body, `crit_${tpl.key}`);
        if (result === "") return [];
        const note = formStr(g.body, `note_${tpl.key}`);
        return [
          {
            key: tpl.key,
            result,
            ...(note !== "" ? { note: clipCp(note, 1000) } : {}),
          },
        ];
      },
    );
    const r = await decideReview(
      stores.reviews,
      g.id,
      {
        outcome: formStr(g.body, "outcome"),
        summary: formStr(g.body, "summary"),
        criteriaResults,
        // 232-7 E6: hidden field carries the advisory run id the page
        // rendered — human submit records it (D-232-4 boundary intact:
        // decidedBy is still the operator). 232-12 C-1: the facade
        // server-validates the ref against the run log.
        aiRunRef: formStr(g.body, "aiRunRef") || undefined,
      },
      g.operator,
      { aiStore },
    );
    return c.redirect(
      backTo("reviews", g.id, r.ok ? { ok: "decided" } : { err: r.error }),
      303,
    );
  });

  app.post("/admin/review-center/reviews/:id/reopen", async (c) => {
    const g = await guardMutation(c, "reviews", c.req.param("id"), reviewIdSchema);
    if (!g.ok) return g.res;
    const reason = formStr(g.body, "reason");
    const r = await reopenReview(stores.reviews, g.id, g.operator, {
      reason: reason === "" ? null : clipCp(reason, 300),
    });
    return c.redirect(
      backTo("reviews", g.id, r.ok ? { ok: "reopened" } : { err: r.error }),
      303,
    );
  });

  app.post("/admin/review-center/reviews/:id/return", async (c) => {
    const g = await guardMutation(c, "reviews", c.req.param("id"), reviewIdSchema);
    if (!g.ok) return g.res;
    const r = await returnToTriage(stores.reviews, g.id, g.operator);
    return c.redirect(
      backTo("reviews", g.id, r.ok ? { ok: "returned" } : { err: r.error }),
      303,
    );
  });

  app.post("/admin/review-center/reviews/:id/evidence", async (c) => {
    const g = await guardMutation(c, "reviews", c.req.param("id"), reviewIdSchema);
    if (!g.ok) return g.res;
    const uri = formStr(g.body, "uri");
    const label = formStr(g.body, "label");
    const description = formStr(g.body, "description");
    const r = await addReviewEvidence(
      stores.reviews,
      g.id,
      [
        {
          type: formStr(g.body, "type"),
          uri,
          label: label === "" ? null : label,
          description: description === "" ? null : description,
        },
      ],
      "OPERATOR",
    );
    return c.redirect(
      backTo(
        "reviews",
        g.id,
        r.ok ? { ok: "evidence_added" } : { err: r.error },
      ),
      303,
    );
  });

}
