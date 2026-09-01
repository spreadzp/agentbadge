import type { Assertion } from "../rule-engine/assertion-builder";
import type { ScoreResult, ScoreDelta } from "./scoring-types";
import type { ScoringConfig } from "./scoring-types";
import type { Pillar } from "../shared.schema";
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

    const category = (current as unknown as { category?: string }).category;
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

  const pillarDeltas: Partial<Record<Pillar, number>> = {};
  if (currentResult.pillars && previousResult.pillars) {
    for (const pillar of Object.keys(currentResult.pillars) as Pillar[]) {
      const current = currentResult.pillars[pillar];
      const previous = previousResult.pillars[pillar];
      if (current && previous) {
        const delta = roundTo2(current.score - previous.score);
        if (delta !== 0) {
          pillarDeltas[pillar] = delta;
        }
      }
    }
  }

  return {
    totalDelta,
    categoryDeltas,
    pillarDeltas,
    statusChanges,
    items,
  };
}

function getScoredCount(assertions: Assertion[], category: string): number {
  return assertions.filter(
    (a) => (a as unknown as { category?: string }).category === category && a.status !== "NOT_APPLICABLE",
  ).length;
}
