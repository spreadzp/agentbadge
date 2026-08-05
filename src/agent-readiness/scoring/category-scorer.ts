import type { Assertion } from "../rule-engine/assertion-builder";
import type { ScoringConfig, CategoryScore } from "./scoring-types";
import type { Category } from "../shared.schema";

export function roundTo2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function scoreCategory(
  category: Category,
  assertions: Assertion[],
  config: ScoringConfig,
): CategoryScore {
  const scored = assertions.filter((a) => {
    // Only assertions that are counted_in_score
    // Assertion doesn't have counted_in_score directly — it's on the rule
    // We accept all assertions here; the orchestrator filters by rule
    return true;
  });

  const denominator = scored.filter((a) => a.status !== "NOT_APPLICABLE");

  const weight = config.categoryWeights[category] ?? 0;

  const totalContribution = denominator.reduce(
    (sum, a) => sum + (config.statusContributions[a.status] ?? 0),
    0,
  );

  const rawScore = denominator.length > 0
    ? (totalContribution / denominator.length) * 100
    : 0;

  return {
    category,
    weight,
    rawScore: roundTo2(rawScore),
    score: roundTo2(rawScore),
    ruleCount: scored.length,
    applicableCount: denominator.length,
    floorTriggered: false,
  };
}
