import type { Assertion } from "../rule-engine/assertion-builder";
import type { ScoreResult, ScoreDelta } from "./scoring-types";
import type { ScoringConfig } from "./scoring-types";
import { roundTo2 } from "./category-scorer";

export interface ScoreDeltaItem {
  ruleId: string;
  category: string;
  previousStatus: Assertion["status"];
  currentStatus: Assertion["status"];
  scoreImpact: number;
}

export function computeDelta(
  currentAssertions: Assertion[],
  previousAssertions: Assertion[],
  currentResult: ScoreResult,
  previousResult: ScoreResult,
  config: ScoringConfig,
): ScoreDelta {
  const previousMap = new Map<string, Assertion>();
  for (const a of previousAssertions) {
    previousMap.set(a.rule_id, a);
  }

  const items: ScoreDeltaItem[] = [];

  for (const current of currentAssertions) {
    const previous = previousMap.get(current.rule_id);
    if (!previous) continue;
    if (current.status === previous.status) continue;

    const category = (current as any).category as string | undefined;
    if (!category) continue;

    const weight = (config.categoryWeights as unknown as Record<string, number>)[category] ?? 0;
    const scoredCount = getScoredCount(currentAssertions, category);
    const perRuleWeight = scoredCount > 0 ? (100 * weight) / scoredCount : 0;

    const previousContribution = (config.statusContributions[previous.status] ?? 0) * perRuleWeight;
    const currentContribution = (config.statusContributions[current.status] ?? 0) * perRuleWeight;
    const scoreImpact = roundTo2(currentContribution - previousContribution);

    items.push({
      ruleId: current.rule_id,
      category,
      previousStatus: previous.status,
      currentStatus: current.status,
      scoreImpact,
    });
  }

  const totalDelta = roundTo2(
    currentResult.total.score - previousResult.total.score,
  );

  const statusChanges = items.map((item) => ({
    ruleId: item.ruleId,
    from: item.previousStatus,
    to: item.currentStatus,
  }));

  const categoryDeltas: Record<string, number> = {};
  for (const item of items) {
    categoryDeltas[item.category] = (categoryDeltas[item.category] ?? 0) + item.scoreImpact;
  }

  return {
    totalDelta,
    categoryDeltas,
    statusChanges,
    items,
  };
}

function getScoredCount(assertions: Assertion[], category: string): number {
  return assertions.filter(
    (a) => (a as any).category === category && a.status !== "NOT_APPLICABLE",
  ).length;
}
