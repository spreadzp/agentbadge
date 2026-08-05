import type { Assertion } from "../rule-engine/assertion-builder";
import type { ScoreResult, ScoringConfig, CategoryScore } from "./scoring-types";
import type { Category } from "../shared.schema";
import { loadScoringConfig, type RulesetManifest } from "./scoring-config";
import { scoreCategory } from "./category-scorer";
import { checkFloor, applyFloorToCategories } from "./floor-enforcer";
import { computeTotalScore } from "./total-scorer";
import { computeDelta } from "./delta-computer";

export interface ScoringEngineInput {
  assertions: Assertion[];
  rulesetManifest: RulesetManifest;
  previousResult?: ScoreResult | null;
  previousAssertions?: Assertion[] | null;
}

export function runScoringEngine(input: ScoringEngineInput): ScoreResult {
  const config = loadScoringConfig(input.rulesetManifest);

  const categoryMap = groupByCategory(input.assertions);

  const rawCategoryScores: CategoryScore[] = Array.from(categoryMap.entries()).map(
    ([category, assertions]) => scoreCategory(category as Category, assertions, config),
  );

  const floorCheck = checkFloor(input.assertions, config);

  const categoryScores = applyFloorToCategories(rawCategoryScores, floorCheck);

  const total = computeTotalScore(categoryScores, floorCheck);

  const categoriesRecord = categoryScores.reduce(
    (acc, cs) => {
      acc[cs.category] = cs;
      return acc;
    },
    {} as Record<Category, CategoryScore>,
  );

  let delta: ScoreResult["delta"] = null;
  if (input.previousResult && input.previousAssertions) {
    const currentResultPartial: ScoreResult = {
      categories: categoriesRecord,
      total,
      delta: null,
      config,
      computedAt: new Date().toISOString(),
    };
    delta = computeDelta(
      input.assertions,
      input.previousAssertions,
      currentResultPartial,
      input.previousResult,
      config,
    );
  }

  return {
    categories: categoriesRecord,
    total,
    delta,
    config,
    computedAt: new Date().toISOString(),
  };
}

function groupByCategory(assertions: Assertion[]): Map<string, Assertion[]> {
  const map = new Map<string, Assertion[]>();
  for (const a of assertions) {
    const category = (a as any).category as string | undefined;
    if (!category) continue;
    const list = map.get(category) ?? [];
    list.push(a);
    map.set(category, list);
  }
  return map;
}
