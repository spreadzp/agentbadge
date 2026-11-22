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

  const template = criteriaForReview(cur.reviewType);
  const cv = validateCriteriaResults(template, input.criteriaResults);
  if (!cv.ok) return cv;

  const requiredFailed = input.criteriaResults.some(
    (r) =>
      r.result === "FAIL" &&
      template.find((c) => c.key === r.key)?.required === true,
  );
  if (requiredFailed && APPROVING.has(input.outcome)) {
    return { ok: false, error: "inconsistent_outcome", field: "outcome" };
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
    },
    event,
  );
  if (!res.transitioned) {
    return {
      ok: false,
      error: res.reason === "missing" ? "not_found" : "status_mismatch",
    };
  }
  emitReviewHooks(id, [event]);
  return { ok: true, record: res.record, decision: res.decision };
}
