import type { Assertion } from "../rule-engine/assertion-builder";
import type { AgentReadinessRule } from "../rule.schema";
import { bundleForRule } from "../rule-bundles";
import type { BundleId } from "../rule-bundles";
import { DEFAULT_STATUS_CONTRIBUTIONS } from "./scoring-types";
import { roundTo2 } from "./category-scorer";

/**
 * Per-bundle sub-score (SLICE-133-10, D6): weighted pass rate computed
 * over the bundle's own assertions only, reusing the canonical
 * statusContributions weights (VERIFIED 1.0, INFERRED 0.7, else 0).
 */
export interface BundleScore {
  /** 0–100 weighted pass rate within the bundle. */
  score: number;
  maxScore: 100;
  verified: number;
  gap: number;
  conflict: number;
}

export interface BundleScoresResult {
  /** Output shape version — additive field, bump on breaking changes. */
  v: 1;
  /** Only bundles with at least one scored assertion appear. */
  scores: Partial<Record<BundleId, BundleScore>>;
}

/**
 * Group assertions by their rule's bundle and compute a sub-score per
 * bundle. Rules with `counted_in_score: false` and NOT_APPLICABLE
 * assertions are excluded from the denominator (same rule as the
 * category scorer). Unknown rule ids are ignored.
 *
 * Pure post-step — the scoring engine stays untouched; callers merge
 * this into the report alongside `runScoringEngine` output.
 */
export function computeBundleScores(
  assertions: readonly Assertion[],
  rules: readonly AgentReadinessRule[],
): BundleScoresResult {
  const ruleById = new Map(rules.map((r) => [r.rule_id, r]));
  const grouped = new Map<BundleId, Assertion[]>();

  for (const a of assertions) {
    const rule = ruleById.get(a.rule_id);
    if (!rule || rule.counted_in_score === false) continue;
    const bundle = bundleForRule(rule);
    if (!bundle) continue;
    const list = grouped.get(bundle);
    if (list) list.push(a);
    else grouped.set(bundle, [a]);
  }

  const scores: Partial<Record<BundleId, BundleScore>> = {};
  for (const [bundle, list] of grouped) {
    const denominator = list.filter((a) => a.status !== "NOT_APPLICABLE");
    const contribution = denominator.reduce(
      (sum, a) =>
        sum +
        (DEFAULT_STATUS_CONTRIBUTIONS[
          a.status as keyof typeof DEFAULT_STATUS_CONTRIBUTIONS
        ] ?? 0),
      0,
    );
    scores[bundle] = {
      score: denominator.length > 0 ? roundTo2((contribution / denominator.length) * 100) : 0,
      maxScore: 100,
      verified: list.filter((a) => a.status === "VERIFIED").length,
      gap: list.filter((a) => a.status === "GAP").length,
      conflict: list.filter((a) => a.status === "CONFLICT").length,
    };
  }

  return { v: 1, scores };
}
