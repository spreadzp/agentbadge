/**
 * EPIC-230 (SLICE-230-5, D-230-11): Review Center form mutations —
 * form-encoded PRG back to the detail page.
 *
 * Guards on every POST (Arc lessons 5-7):
 *  - single-use formToken consumed at the edge (double-submit/F5 →
 *    honest "expired" flash, the domain write never runs twice)
 *  - operator ref → opOf normalize + isOperatorRef shape check
 *  - flash values are whitelist codes via backTo(), never free text
 */

import type { Context, Hono } from "hono";

import {
  closeFeedback,
  resolveFeedback,
  triageFeedback,
} from "../../lib/feedback/workflow";
import {
  claimReview,
  declineReview,
  reopenReview,
  returnToTriage,
} from "../../lib/reviews/workflow";
import { decideReview } from "../../lib/reviews/decide";
import { addReviewEvidence } from "../../lib/reviews/evidence";
import { criteriaForReview } from "../../lib/reviews/criteria";
import {
  convertFeedbackToDraft,
  convertReviewToDraft,
} from "../../lib/knowledge-draft/convert";
import { unavailableDraftPort } from "../../lib/knowledge-draft/port";
import { feedbackIdSchema } from "../../lib/feedback/validate";
import { reviewIdSchema } from "../../lib/reviews/validate";
import type { FeedbackReviewStores } from "./mount";
import {
  backTo,
  FORM_TOKEN_ERR,
  formStr,
  opBad,
  opOf,
  tokenConsumed,
} from "./review-center-shared";

const badId = () => new Response(null, { status: 404 });

/** Shared POST prelude: parse → id → token → operator guards.
 *  Returns {body, operator} or a redirect Response. */
async function guardMutation(
  c: Context,
  queue: "feedback" | "reviews",
  rawId: string,
  idSchema: { safeParse: (v: unknown) => { success: boolean; data?: string } },
): Promise<
  | { ok: true; body: Record<string, unknown>; operator: string; id: string }
  | { ok: false; res: Response }
> {
  const id = idSchema.safeParse(rawId);
  if (!id.success || id.data === undefined) {
    return { ok: false, res: badId() };
  }
  const body = (await c.req.parseBody()) as Record<string, unknown>;
  if (!tokenConsumed(body)) {
    return {
      ok: false,
      res: c.redirect(backTo(queue, id.data, { err: FORM_TOKEN_ERR }), 303),
    };
  }
  if (opBad(body)) {
    return {
      ok: false,
      res: c.redirect(backTo(queue, id.data, { err: "bad_operator" }), 303),
    };
  }
  return { ok: true, body, operator: opOf(body), id: id.data };
}

export function registerReviewCenterMutations(
  app: Hono,
  stores: FeedbackReviewStores,
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
      suggestion: suggestion === "" ? undefined : suggestion,
    });
    return c.redirect(
      backTo("feedback", g.id, r.ok ? { ok: "resolved" } : { err: r.error }),
      303,
    );
  });

  app.post("/admin/review-center/feedback/:id/close", async (c) => {
    const g = await guardMutation(c, "feedback", c.req.param("id"), feedbackIdSchema);
    if (!g.ok) return g.res;
    const r = await closeFeedback(stores.feedback, g.id, g.operator);
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

  app.post("/admin/review-center/reviews/:id/decline", async (c) => {
    const g = await guardMutation(c, "reviews", c.req.param("id"), reviewIdSchema);
    if (!g.ok) return g.res;
    const note = formStr(g.body, "reason");
    const r = await declineReview(
      stores.reviews,
      g.id,
      formStr(g.body, "declineReason"),
      g.operator,
      { reason: note === "" ? null : note.slice(0, 300) },
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
            ...(note !== "" ? { note: note.slice(0, 1000) } : {}),
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
      },
      g.operator,
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
      reason: reason === "" ? null : reason.slice(0, 300),
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

  // ── knowledge-draft conversion (D-230-10) ───────────────────

  app.post("/admin/review-center/feedback/:id/convert", async (c) => {
    const g = await guardMutation(c, "feedback", c.req.param("id"), feedbackIdSchema);
    if (!g.ok) return g.res;
    const r = await convertFeedbackToDraft(
      stores.feedback,
      stores.draftPort ?? unavailableDraftPort(),
      g.id,
      g.operator,
    );
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
    );
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
