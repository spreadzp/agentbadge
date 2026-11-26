/**
 * EPIC-230 (SLICE-230-3, D-230-5): operator workflow on review cases.
 *
 * PENDING_TRIAGE --claimReview--> IN_REVIEW --decide.ts--> DECIDED
 *     |                 |  \--declineReview--> DECLINED (reason enum)
 *     |                 |--declineReview--> DECLINED
 * DECIDED --reopenReview--> REOPENED --returnToTriage--> PENDING_TRIAGE
 *
 * `from` is the DOMAIN-expected status (lost-update precondition —
 * a stale admin screen can't re-drive a case another operator moved).
 * All transition events are INTERNAL: they carry the operator ref and
 * operator identity never belongs on a public event (D-228-8); the
 * public surface reads status/decision off the record (D-230-9).
 */

import { buildReviewEvent, emitReviewHooks } from "./events";
import { validateAiRunRef } from "../ai/run-ref";
import type { AiStore } from "../ai/types";
import type { ReviewResult } from "./evidence";
import type { ReviewStore, ReviewTransitionResult } from "./store";
import type {
  ReviewCaseRecord,
  ReviewDeclineReason,
  ReviewStatus,
} from "./types";
import { declineReasonSchema } from "./validate";

const eventKindFor = (to: string) =>
  to === "IN_REVIEW"
    ? "review.claimed"
    : to === "DECLINED"
      ? "review.declined"
      : to === "REOPENED"
        ? "review.reopened"
        : to === "PENDING_TRIAGE"
          ? "review.returned"
          : "review.status_changed";

function mapRefusal(
  res: Extract<ReviewTransitionResult, { transitioned: false }>,
): { ok: false; error: string } {
  return {
    ok: false,
    error:
      res.reason === "missing"
        ? "not_found"
        : res.reason === "illegal"
          ? "illegal_transition"
          : res.reason === "precondition_required"
            ? "precondition_required"
            : "status_mismatch",
  };
}

async function doTransition(
  store: ReviewStore,
  id: string,
  from: string,
  to: ReviewStatus,
  operatorRef: string,
  extra?: { declineReason?: string | null; reason?: string | null },
): Promise<ReviewResult<{ record: ReviewCaseRecord }>> {
  const event = buildReviewEvent(eventKindFor(to), "INTERNAL", {
    reviewId: id,
    from,
    to,
    actor: operatorRef,
    ...(extra?.declineReason != null
      ? { declineReason: extra.declineReason }
      : {}),
    ...(extra?.reason != null ? { reason: extra.reason } : {}),
  });
  const res = await store.transitionReview(
    id,
    {
      from,
      to,
      actor: operatorRef,
      declineReason: extra?.declineReason ?? null,
      reason: extra?.reason ?? null,
    },
    event,
  );
  if (!res.transitioned) return mapRefusal(res);
  emitReviewHooks(id, [event]);
  return { ok: true, record: res.record };
}

/** PENDING_TRIAGE→IN_REVIEW — the claim. Store stamps
 *  assignee=actor + claimedAt under the lock (D-230-5). */
export function claimReview(
  store: ReviewStore,
  id: string,
  operatorRef: string,
): Promise<ReviewResult<{ record: ReviewCaseRecord }>> {
  return doTransition(store, id, "PENDING_TRIAGE", "IN_REVIEW", operatorRef);
}

/** PENDING_TRIAGE|IN_REVIEW→DECLINED — closed-vocab reason required. */
export async function declineReview(
  store: ReviewStore,
  id: string,
  rawReason: unknown,
  operatorRef: string,
  opts?: { reason?: string | null; from?: string },
): Promise<ReviewResult<{ record: ReviewCaseRecord }>> {
  const reason = declineReasonSchema.safeParse(rawReason);
  if (!reason.success) {
    return { ok: false, error: "invalid_decline_reason", field: "declineReason" };
  }
  // Arc 230-8 M12: decline has two legal sources — the caller's
  // observed status is the `from`, not a fresh read (stale screen
  // can't silently drive someone else's claimed case to DECLINED).
  const from = opts?.from;
  if (
    from === undefined ||
    (from !== "PENDING_TRIAGE" && from !== "IN_REVIEW")
  ) {
    return { ok: false, error: "illegal_transition" };
  }
  return doTransition(store, id, from, "DECLINED", operatorRef, {
    declineReason: reason.data satisfies ReviewDeclineReason,
    reason: opts?.reason ?? null,
  });
}

/** DECIDED→REOPENED — reopenCount++ under the lock (§17.3 metric). */
export function reopenReview(
  store: ReviewStore,
  id: string,
  operatorRef: string,
  opts?: { reason?: string | null },
): Promise<ReviewResult<{ record: ReviewCaseRecord }>> {
  return doTransition(store, id, "DECIDED", "REOPENED", operatorRef, {
    reason: opts?.reason ?? null,
  });
}

/** REOPENED→PENDING_TRIAGE — releases the claim (assignee=null). */
export function returnToTriage(
  store: ReviewStore,
  id: string,
  operatorRef: string,
): Promise<ReviewResult<{ record: ReviewCaseRecord }>> {
  return doTransition(store, id, "REOPENED", "PENDING_TRIAGE", operatorRef);
}

/**
 * 232-9 E9 / 232-12 C-1: operator dismisses the advisory suggestion.
 *
 * Goes through the same gates as a decide — claimed IN_REVIEW case,
 * assignee-only, server-verified run ref — then appends ONE
 * INTERNAL `review.ai_suggestion_rejected` event per run (repeat
 * submissions are a duplicate no-op, not a metric-inflating second
 * row). The human still decides normally afterwards.
 */
export async function rejectAiSuggestion(
  store: ReviewStore,
  aiStore: Pick<AiStore, "listRuns">,
  id: string,
  operatorRef: string,
  input: { runId: string; reason?: string | null },
): Promise<ReviewResult<{ duplicate: boolean }>> {
  const cur = await store.getReview(id);
  if (!cur) return { ok: false, error: "not_found" };
  if (cur.status !== "IN_REVIEW") {
    return { ok: false, error: "status_mismatch" };
  }
  if (cur.assignee !== operatorRef) {
    return { ok: false, error: "not_assignee" };
  }
  const v = await validateAiRunRef(aiStore, input.runId, {
    subjectType: "review_case",
    subjectId: id,
    scenario: "review_assist",
  });
  if (!v.ok) return { ok: false, error: v.error, field: "aiRunRef" };

  const prior = await store.listEvents(id, { visibility: "INTERNAL" });
  const dup = prior.some(
    (e) =>
      e.kind === "review.ai_suggestion_rejected" &&
      (e.payload as { runId?: unknown } | null)?.runId === input.runId,
  );
  if (dup) return { ok: true, duplicate: true };

  const event = buildReviewEvent("review.ai_suggestion_rejected", "INTERNAL", {
    runId: input.runId,
    scenario: "review_assist",
    actor: operatorRef,
    reason: input.reason ?? null,
  });
  await store.appendEvents(id, [event]);
  emitReviewHooks(id, [event]);
  return { ok: true, duplicate: false };
}
