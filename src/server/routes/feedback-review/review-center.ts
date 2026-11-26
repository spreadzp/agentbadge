/**
 * EPIC-230 (SLICE-230-5, D-230-11): Review Center SSR —
 *   GET /admin/review-center?queue=feedback|reviews&status=&offset=
 *   GET /admin/review-center/feedback/:id
 *   GET /admin/review-center/reviews/:id
 *
 * Browser auth: operatorBrowserAuth (HTTP Basic, opk_ credential) —
 * same posture as /admin/interactions. Form mutations live in
 * review-center-mutations.ts; every rendered form mints a
 * single-use formToken (Arc R2 H-1 lesson).
 */

import { Hono } from "hono";
import type { Context } from "hono";

import { pickOperatorStores, type OperatorStore } from "../../lib/operators";
import { getDatabase } from "../../lib/database";
import { operatorBrowserAuth } from "../../middleware/operatorAuth";
import { capabilityGate } from "../../middleware/operator-gate";
import { errorResponse } from "../../lib/error-response";
import { ErrorCodes } from "../../lib/error-codes";
import { mintFormToken } from "../../lib/knowledge/form-tokens";
import { wrapFragment } from "../ui/helpers";
import { FEEDBACK_STATUSES } from "../../lib/feedback/types";
import { REVIEW_STATUSES } from "../../lib/reviews/types";
import { feedbackIdSchema } from "../../lib/feedback/validate";
import { reviewIdSchema } from "../../lib/reviews/validate";
import type { FeedbackReviewStores } from "./mount";
import {
  draftExportPayload,
  feedbackDraftInput,
  reviewDraftInput,
} from "../../lib/knowledge-draft/convert";
import {
  readOffset,
  readQueue,
  readStatus,
} from "./review-center-shared";
import { registerReviewCenterMutations } from "./review-center-mutations";
import { registerReviewCenterConversions } from "./review-center-convert";
import { loadAiSuggestions } from "../../lib/ai/intake";
import type { AiStore } from "../../lib/ai/types";
import {
  feedbackQueuePage,
  reviewsQueuePage,
} from "../../../views/admin-review-center/queue";
import { feedbackDetailPage } from "../../../views/admin-review-center/feedback-detail";
import { reviewDetailPage } from "../../../views/admin-review-center/review-detail";

const page = (c: Context, frag: string, title: string): Response =>
  c.html(
    wrapFragment(c, frag, title, {
      path: c.req.path,
      title: `Review Center — ${title}`,
      description: `Review Center — ${title}`,
    }),
    200,
    { "Cache-Control": "no-store" },
  );

const QUEUE_PAGE = 50;

export function createReviewCenter(deps: {
  stores: FeedbackReviewStores;
  /** SLICE-264-8: credential store for operatorAuth — tests inject. */
  operatorStore?: OperatorStore;
  /** 232-6 E5: advisory AI extraction suggestions — absent → none shown. */
  aiStore?: AiStore;
}): Hono {
  const app = new Hono();
  const { stores } = deps;
  const opStore = deps.operatorStore ?? pickOperatorStores(getDatabase());
  // 264-8: one mount (path/* covers the bare path in Hono 4) —
  // GETs → read cap, form POSTs → workflow.
  app.use(
    "/admin/review-center/*",
    operatorBrowserAuth(opStore),
    capabilityGate(),
  );
  // B-3 prod-verify (228 precedent): browsers auto-attach cached
  // Basic credentials to cross-site form POSTs — require Origin to
  // match the request host when the header is present.
  app.use("/admin/review-center/*", async (c, next) => {
    if (c.req.method !== "POST") return next();
    const origin = c.req.header("origin");
    if (!origin) return next();
    try {
      // Host-only compare (229 convention): behind TLS-terminating
      // proxies c.req.url's scheme may differ from the browser's —
      // the single-use form token is the real CSRF control (Arc
      // 230-8 nit, accepted tradeoff).
      if (new URL(origin).host === new URL(c.req.url).host) return next();
    } catch {
      /* malformed origin → reject below */
    }
    return errorResponse(
      c,
      403,
      ErrorCodes.UNAUTHORIZED,
      "cross-origin form post refused",
    );
  });

  app.get("/admin/review-center", async (c) => {
    const queue = readQueue(c.req.query("queue"));
    const st = readStatus(queue, c.req.query("status"));
    if (!st.ok) {
      return errorResponse(c, 400, ErrorCodes.INVALID_INPUT, "bad status");
    }
    const offset = readOffset(c.req.query("offset"));
    const limit = QUEUE_PAGE + 1;
    if (queue === "feedback") {
      const rows = await stores.feedback.listFeedback({
        status: st.status,
        limit,
        offset,
      });
      const page50 = rows.slice(0, QUEUE_PAGE);
      return page(
        c,
        feedbackQueuePage({
          items: page50,
          status: st.status ?? "all",
          statuses: [...FEEDBACK_STATUSES, "all"],
          nextOffset: rows.length > QUEUE_PAGE ? offset + QUEUE_PAGE : null,
          offset,
        }),
        "Feedback queue",
      );
    }
    const rows = await stores.reviews.listReviews({
      status: st.status,
      limit,
      offset,
    });
    const page50 = rows.slice(0, QUEUE_PAGE);
    // 232-9 E9: per-row AI lane — a successful review_assist run's
    // modeAtTime drives "needs confirm" vs "ai suggested" vs "manual".
    const items = await Promise.all(
      page50.map(async (row) => {
        const run = deps.aiStore
          ? await deps.aiStore.latestRunFor("review_case", row.id, "review_assist")
          : null;
        const aiState =
          run?.modeAtTime === "supervised"
            ? ("confirm" as const)
            : run != null
              ? ("suggested" as const)
              : ("manual" as const);
        return { row, aiState };
      }),
    );
    return page(
      c,
      reviewsQueuePage({
        items,
        status: st.status ?? "all",
        statuses: [...REVIEW_STATUSES, "all"],
        nextOffset: rows.length > QUEUE_PAGE ? offset + QUEUE_PAGE : null,
        offset,
      }),
      "Reviews queue",
    );
  });

  app.get("/admin/review-center/feedback/:id", async (c) => {
    const id = feedbackIdSchema.safeParse(c.req.param("id"));
    if (!id.success) {
      return errorResponse(c, 404, ErrorCodes.REQUEST_NOT_FOUND, "no such feedback");
    }
    const rec = await stores.feedback.getFeedback(id.data);
    if (!rec) {
      return errorResponse(c, 404, ErrorCodes.REQUEST_NOT_FOUND, "no such feedback");
    }
    const [events, aiSuggestions] = await Promise.all([
      stores.feedback.listEvents(id.data),
      deps.aiStore
        ? loadAiSuggestions(
            deps.aiStore,
            id.data,
            ["feedback_extract"],
            "feedback",
          )
        : Promise.resolve([]),
    ]);
    return page(
      c,
      feedbackDetailPage({
        record: rec,
        events,
        aiSuggestions,
        formToken: mintFormToken(),
        flash: { ok: c.req.query("ok"), err: c.req.query("err") },
      }),
      rec.id,
    );
  });

  app.get("/admin/review-center/reviews/:id", async (c) => {
    const id = reviewIdSchema.safeParse(c.req.param("id"));
    if (!id.success) {
      return errorResponse(c, 404, ErrorCodes.REQUEST_NOT_FOUND, "no such review");
    }
    const rec = await stores.reviews.getReview(id.data);
    if (!rec) {
      return errorResponse(c, 404, ErrorCodes.REQUEST_NOT_FOUND, "no such review");
    }
    const [evidence, decisions, events, aiSuggestions] = await Promise.all([
      stores.reviews.listEvidence(id.data),
      stores.reviews.listDecisions(id.data),
      stores.reviews.listEvents(id.data),
      deps.aiStore
        ? loadAiSuggestions(
            deps.aiStore,
            id.data,
            ["feedback_extract", "review_assist"],
            "review_case",
          )
        : Promise.resolve([]),
    ]);
    return page(
      c,
      reviewDetailPage({
        record: rec,
        evidence,
        decisions,
        events,
        aiSuggestions,
        formToken: mintFormToken(),
        flash: { ok: c.req.query("ok"), err: c.req.query("err") },
      }),
      rec.id,
    );
  });

  // D-230-10 JSON-export fallback — the would-be draft payload, so
  // an operator can file it by hand when the port is unavailable.
  app.get("/admin/review-center/feedback/:id/draft.json", async (c) => {
    const id = feedbackIdSchema.safeParse(c.req.param("id"));
    if (!id.success) {
      return errorResponse(c, 404, ErrorCodes.REQUEST_NOT_FOUND, "no such feedback");
    }
    const rec = await stores.feedback.getFeedback(id.data);
    if (!rec) {
      return errorResponse(c, 404, ErrorCodes.REQUEST_NOT_FOUND, "no such feedback");
    }
    // Arc 230-8 nit: export only what could actually convert —
    // ACCEPTED feedback, mirroring the convert-button gate.
    if (rec.status !== "ACCEPTED") {
      return errorResponse(
        c,
        409,
        ErrorCodes.INVALID_STATE,
        "draft export needs an ACCEPTED feedback",
      );
    }
    return c.json(
      JSON.parse(draftExportPayload(feedbackDraftInput(rec), `feedback:${rec.id}`)),
      200,
      { "Cache-Control": "no-store" },
    );
  });

  app.get("/admin/review-center/reviews/:id/draft.json", async (c) => {
    const id = reviewIdSchema.safeParse(c.req.param("id"));
    if (!id.success) {
      return errorResponse(c, 404, ErrorCodes.REQUEST_NOT_FOUND, "no such review");
    }
    const rec = await stores.reviews.getReview(id.data);
    if (!rec) {
      return errorResponse(c, 404, ErrorCodes.REQUEST_NOT_FOUND, "no such review");
    }
    // Arc 230-8 nit: export only what could actually convert —
    // DECIDED reviews, mirroring the convert-button gate.
    if (rec.status !== "DECIDED") {
      return errorResponse(
        c,
        409,
        ErrorCodes.INVALID_STATE,
        "draft export needs a DECIDED review",
      );
    }
    const [evidence, decisions] = await Promise.all([
      stores.reviews.listEvidence(id.data),
      stores.reviews.listDecisions(id.data),
    ]);
    return c.json(
      JSON.parse(draftExportPayload(reviewDraftInput(rec, evidence, decisions), `review:${rec.id}`)),
      200,
      { "Cache-Control": "no-store" },
    );
  });

  registerReviewCenterMutations(app, stores);
  registerReviewCenterConversions(app, stores);
  return app;
}
