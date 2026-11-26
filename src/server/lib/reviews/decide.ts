/**
 * EPIC-230 (SLICE-230-3, D-230-6/8): the human decision.
 *
 * `decideReview` is the ONLY write-path to DECIDED — the store
 * refuses the edge from any other status (PENDING_TRIAGE→DECIDED
 * is not in the table precisely so the append-only decision row
 * always lands with the flip, D-230-8).
 *
 * Criteria validation at the edge (D-230-6): results must cover the
 * case's reviewType template EXACTLY — every platform key present
 * once, no unknown keys, no agent-criteria infiltration. A FAIL on
 * a `required` criterion contradicts APPROVED* outcomes (refused):
 * rubber-stamping a failed must-have is not an honest review.
 */

import { criteriaForReview, type CriterionTemplate } from "./criteria";
import { buildReviewEvent, emitReviewHooks } from "./events";
import { validateAiRunRef } from "../ai/run-ref";
import type { AiStore } from "../ai/types";
import type { ReviewResult } from "./evidence";
import type { ReviewStore } from "./store";
import type {
  ReviewCaseRecord,
  ReviewDecisionRecord,
} from "./types";
import {
  decideReviewSchema,
  type CriterionResultInput,
} from "./validate";

const APPROVING = new Set(["APPROVED", "APPROVED_WITH_NOTES"]);

function validateCriteriaResults(
  template: readonly CriterionTemplate[],
  results: CriterionResultInput[],
): { ok: true } | { ok: false; error: string; field?: string } {
  const byKey = new Map(template.map((c) => [c.key, c]));
  const seen = new Set<string>();
  for (const r of results) {
    const c = byKey.get(r.key);
    if (!c) {
      // Unknown keys refuse — agentCriteria must never enter the
      // platform scoring structure (D-230-6).
      return { ok: false, error: "unknown_criterion", field: `criteriaResults.${r.key}` };
    }
    if (seen.has(r.key)) {
      return { ok: false, error: "duplicate_criterion", field: `criteriaResults.${r.key}` };
    }
    seen.add(r.key);
  }
  const missing = template.filter((c) => !seen.has(c.key));
  if (missing.length > 0) {
    return {
      ok: false,
      error: "missing_criteria",
      field: missing[0]!.key,
    };
  }
  return { ok: true };
}

export async function decideReview(
  store: ReviewStore,
  id: string,
  raw: unknown,
  operatorRef: string,
  /** 232-12 C-1: when `aiRunRef` is asserted the caller MUST pass the
   *  ai store — the link is validated server-side; absent the store
   *  the reference is refused, never silently trusted. */
  deps?: { aiStore?: Pick<AiStore, "listRuns"> | null },
): Promise<
  ReviewResult<{
    record: ReviewCaseRecord;
    decision: ReviewDecisionRecord;
  }>
> {
  const parsed = decideReviewSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      ok: false,
      error: issue?.message ?? "invalid decision",
      field: issue?.path.join("."),
    };
  }
  const input = parsed.data;

  const cur = await store.getReview(id);
  if (!cur) return { ok: false, error: "not_found" };
  if (cur.status !== "IN_REVIEW") {
    return { ok: false, error: "status_mismatch" };
  }
  // Arc 230-8 M8: the claim is an accountability boundary — only the
  // assignee decides (or an explicit re-claim changes the assignee).
  if (cur.assignee !== operatorRef) {
    return { ok: false, error: "not_assignee" };
  }

  const template = criteriaForReview(cur.reviewType);
  const cv = validateCriteriaResults(template, input.criteriaResults);
  if (!cv.ok) return cv;

  // Arc 230-8 M8: an approving outcome requires every required
  // criterion to be an explicit PASS — NA is not approval.
  if (APPROVING.has(input.outcome)) {
    const badRequired = input.criteriaResults.some(
      (r) =>
        r.result !== "PASS" &&
        template.find((c) => c.key === r.key)?.required === true,
    );
    if (badRequired) {
      return { ok: false, error: "inconsistent_outcome", field: "outcome" };
    }
  }

  // 232-12 C-1: the advisory-run link is operator-asserted input —
  // verify it against the run log before it lands on the decision
  // (wrong-subject/shadow/failed refs refuse; store absent refuses).
  if (input.aiRunRef) {
    if (!deps?.aiStore) {
      return { ok: false, error: "invalid_ai_run_ref", field: "aiRunRef" };
    }
    const v = await validateAiRunRef(deps.aiStore, input.aiRunRef, {
      subjectType: "review_case",
      subjectId: id,
      scenario: "review_assist",
    });
    if (!v.ok) {
      return { ok: false, error: v.error, field: "aiRunRef" };
    }
  }

  const event = buildReviewEvent("review.decided", "INTERNAL", {
    reviewId: id,
    outcome: input.outcome,
    decidedBy: operatorRef,
    criteriaResults: input.criteriaResults,
  });
  const res = await store.decideReview(
    id,
    {
      outcome: input.outcome,
      criteriaResults: input.criteriaResults,
      summary: input.summary,
      decidedBy: operatorRef,
      // 232-7 E6: the human's optional reference to an advisory run —
      // decidedBy stays the only identity on the row (D-232-4).
      aiRunRef: input.aiRunRef ?? null,
    },
    event,
  );
  if (!res.transitioned) {
    // Store-level guard reasons use the same vocabulary as the
    // facade errors (Arc 230-8 H3 note) — pass them through.
    return {
      ok: false,
      error: res.reason === "missing" ? "not_found" : res.reason,
    };
  }
  emitReviewHooks(id, [event]);
  return { ok: true, record: res.record, decision: res.decision };
}
