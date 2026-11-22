/**
 * EPIC-230 (SLICE-230-4/6/7): domain wiring —
 * mounts public API + Review Center, the KnowledgeDraftPort adapter,
 * the Telegram notify hook on intake events and the §17.3 Review
 * Performance metrics.
 *
 * Hooks ride the post-commit seams (lib events modules): fire only
 * AFTER the row commits, fire-and-forget — a TG/metric failure logs
 * a warning, never fails intake. Missing TELEGRAM_BOT_TOKEN/CHAT_ID
 * → graceful no-op (228 precedent).
 */

import type { Hono } from "hono";
import { logger } from "@agentbadge/passport/logger";

import { getDatabase } from "../lib/database";
import { pickFeedbackStore } from "../lib/feedback/db-stores";
import { pickReviewStore } from "../lib/reviews/db-stores";
import type { ReviewStore } from "../lib/reviews/store";
import { pickKnowledgeStores } from "../lib/knowledge/db-stores";
import { knowledgeDraftPort } from "../lib/knowledge-draft/port";
import { onFeedbackEvent } from "../lib/feedback/events";
import { onReviewEvent } from "../lib/reviews/events";
import {
  escHtml,
  sendTelegramMessage,
  telegramFromEnv,
} from "../lib/notify/telegram";
import {
  feedbackReceivedTotal,
  knowledgeConversionsTotal,
  reviewDurationSeconds,
  reviewPending,
  reviewsDecidedTotal,
  reviewsReopenedTotal,
  reviewsSubmittedTotal,
} from "../metrics/metrics";
import { mountFeedbackReviewRoutes } from "../routes/feedback-review/mount";

const ADMIN_BASE = "https://agentbadge.xyz/admin/review-center";

/** Arc-audit M10 lesson: collapse whitespace + strip bidi/ctrl chars
 *  BEFORE escaping — a submitter must not inject fake operator lines
 *  into the operator channel. */
const cleanExcerpt = (s: string) =>
  s
    .replace(/[\u0000-\u001f\u007f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);

function notify(
  lines: string[],
  ctx: Record<string, string>,
): void {
  const cfg = telegramFromEnv();
  if (!cfg) return; // TG-off → no-op, never a failure mode
  sendTelegramMessage(lines.join("\n"), cfg).catch((err) => {
    logger.warn("feedback-review: tg notify failed", {
      ...ctx,
      err: err instanceof Error ? err.message : String(err),
    });
  });
}

/** §17.3 "Pending reviews" — PENDING_TRIAGE + REOPENED both sit in
 *  the operator queue. Recomputed fire-and-forget off each review
 *  event; a store failure leaves the last value and logs. */
function refreshReviewPending(reviews: ReviewStore): void {
  void (async () => {
    const [triage, reopened] = await Promise.all([
      reviews.listReviews({ status: "PENDING_TRIAGE", limit: 10_000 }),
      reviews.listReviews({ status: "REOPENED", limit: 10_000 }),
    ]);
    reviewPending.set(triage.length + reopened.length);
  })().catch((err) =>
    logger.warn("feedback-review: pending gauge refresh failed", {
      err: err instanceof Error ? err.message : String(err),
    }),
  );
}

let hookRegistered = false;

function registerHooks(reviews: ReviewStore): void {
  if (hookRegistered) return; // single hook per process (tests remount)
  hookRegistered = true;

  onFeedbackEvent((feedbackId, event) => {
    const p = (event.payload ?? {}) as Record<string, unknown>;
    if (event.kind === "feedback.knowledge_converted") {
      knowledgeConversionsTotal.inc({ source: "feedback" });
      return;
    }
    if (
      event.kind !== "feedback.received" ||
      event.visibility !== "PUBLIC"
    ) {
      return;
    }
    feedbackReceivedTotal.inc({
      kind: String(p.kind ?? "OTHER"),
      target: String(p.target ?? "other"),
    });
    const lines = [
      `<b>New agent feedback</b> ${escHtml(feedbackId)}`,
      `actor: ${escHtml(String(p.actorResolution ?? "ANON"))} · kind: ${escHtml(String(p.kind ?? "—"))} · target: ${escHtml(String(p.target ?? "—"))}`,
    ];
    if (typeof p.excerpt === "string") {
      const clean = cleanExcerpt(p.excerpt);
      if (clean.length > 0) lines.push(escHtml(clean));
    }
    lines.push(
      `<a href="${ADMIN_BASE}/feedback/${escHtml(feedbackId)}">open in review center</a>`,
    );
    notify(lines, { feedbackId });
  });

  onReviewEvent((reviewId, event) => {
    refreshReviewPending(reviews);
    const p = (event.payload ?? {}) as Record<string, unknown>;
    switch (event.kind) {
      case "review.decided": {
        const operator = String(p.decidedBy ?? "unknown");
        reviewsDecidedTotal.inc({
          operator,
          outcome: String(p.outcome ?? "UNKNOWN"),
        });
        void reviews
          .getReview(reviewId)
          .then((rec) => {
            if (!rec?.decidedAt || !rec.createdAt) return;
            const secs =
              (Date.parse(rec.decidedAt) - Date.parse(rec.createdAt)) / 1000;
            if (secs >= 0) reviewDurationSeconds.observe(secs);
          })
          .catch((err) =>
            logger.warn("feedback-review: duration observe failed", {
              reviewId,
              err: err instanceof Error ? err.message : String(err),
            }),
          );
        return;
      }
      case "review.reopened":
        reviewsReopenedTotal.inc();
        return;
      case "review.knowledge_converted":
        knowledgeConversionsTotal.inc({ source: "review" });
        return;
      case "review.submitted": {
        if (event.visibility !== "PUBLIC") return;
        reviewsSubmittedTotal.inc({
          review_type: String(p.reviewType ?? "OTHER"),
        });
        notify(
          [
            `<b>New review request</b> ${escHtml(reviewId)}`,
            `actor: ${escHtml(String(p.actorResolution ?? "ANON"))} · type: ${escHtml(String(p.reviewType ?? "—"))} · evidence: ${escHtml(String(p.evidenceCount ?? 0))}`,
            `<a href="${ADMIN_BASE}/reviews/${escHtml(reviewId)}">open in review center</a>`,
          ],
          { reviewId },
        );
        return;
      }
      default:
        return;
    }
  });
}

export function wireFeedbackReview(app: Hono): void {
  const db = getDatabase();
  const stores = {
    feedback: pickFeedbackStore(db),
    reviews: pickReviewStore(db),
    // D-230-10: real adapter over the shipped 229 service — in memory
    // mode pickKnowledgeStores returns the singleton memory store, so
    // the draft lands in the same seam the admin knowledge UI reads.
    draftPort: knowledgeDraftPort(pickKnowledgeStores(db)),
  };
  mountFeedbackReviewRoutes(app, stores);
  registerHooks(stores.reviews);
}
