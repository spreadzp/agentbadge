import type { Category, Pillar } from "../shared.schema";
import type { CategoryScore, PillarScore, PillarWeights } from "./scoring-types";
import { CATEGORY_TO_PILLAR, PILLARS } from "./pillar-map";

export interface ComputePillarScoresInput {
  categoryScores: CategoryScore[];
  pillarWeights: PillarWeights;
  categoryToPillar?: Readonly<Record<Category, Pillar>>;
}

function roundTo2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function computePillarScores(input: ComputePillarScoresInput): PillarScore[] {
  const map = input.categoryToPillar ?? CATEGORY_TO_PILLAR;

  return PILLARS.map((pillar) => {
    const memberScores = input.categoryScores.filter((cs) => map[cs.category] === pillar);
    const applicable = memberScores.filter((cs) => cs.applicableCount > 0);

    const weightSum = applicable.reduce((sum, cs) => sum + cs.weight, 0);
    const weightedSum = applicable.reduce((sum, cs) => sum + cs.score * cs.weight, 0);

    const rawScore = weightSum > 0 ? weightedSum / weightSum : 0;
    const floorTriggered = memberScores.some((cs) => cs.floorTriggered);

    return {
      pillar,
      weight: input.pillarWeights[pillar],
      rawScore: roundTo2(rawScore),
      score: Math.round(rawScore),
      categoryCount: memberScores.length,
      applicableCount: applicable.length,
      floorTriggered,
    };
  });
}
