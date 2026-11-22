/**
 * EPIC-230 (Arc 230-8 H3 note + M8): the decision invariants that
 * must hold INSIDE the store unit, not only at the facade.
 *
 * A refused decide writes nothing in both backends — the same
 * guards run in store-memory-decisions.ts and are mirrored in the
 * PG repository (packages/database review-repository.ts) so a
 * facade bypass cannot write a decision row with a partial
 * rubric, an approving outcome on a failed required criterion, or
 * a decidedBy that isn't the locked row's assignee.
 */

import { criteriaForReview } from "./criteria";

const APPROVING = new Set(["APPROVED", "APPROVED_WITH_NOTES"]);
const RESULTS = new Set(["PASS", "FAIL", "NA"]);

export type DecideGuardFailure =
  | "not_assignee"
  | "invalid_criteria"
  | "missing_criteria"
  | "unknown_criterion"
  | "duplicate_criterion"
  | "inconsistent_outcome";

/** Returns the refusal reason or null. Runs against the LOCKED row:
 *  `assignee` is compared here so a re-claim racing the facade's
 *  pre-check still loses honestly under the store lock. */
export function decideGuardFailure(
  rec: { assignee: string | null; reviewType: string },
  input: { decidedBy: string; outcome: string; criteriaResults: unknown },
): DecideGuardFailure | null {
  if (rec.assignee !== input.decidedBy) return "not_assignee";
  if (!Array.isArray(input.criteriaResults)) return "invalid_criteria";
  const template = criteriaForReview(rec.reviewType);
  const allowed = new Map(template.map((c) => [c.key, c]));
  const seen = new Set<string>();
  for (const raw of input.criteriaResults) {
    const r = raw as { key?: unknown; result?: unknown };
    if (
      typeof r !== "object" ||
      r === null ||
      typeof r.key !== "string" ||
      typeof r.result !== "string" ||
      !RESULTS.has(r.result)
    ) {
      return "invalid_criteria";
    }
    if (!allowed.has(r.key)) return "unknown_criterion";
    if (seen.has(r.key)) return "duplicate_criterion";
    seen.add(r.key);
  }
  for (const c of template) {
    if (!seen.has(c.key)) return "missing_criteria";
  }
  if (APPROVING.has(input.outcome)) {
    const bad = (input.criteriaResults as { key: string; result: string }[]).some(
      (r) => r.result !== "PASS" && allowed.get(r.key)?.required === true,
    );
    if (bad) return "inconsistent_outcome";
  }
  return null;
}
