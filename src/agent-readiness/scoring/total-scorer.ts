import type { CategoryScore, TotalScore } from "./scoring-types";
import type { FloorCheckResult } from "./floor-enforcer";
import { roundTo2 } from "./category-scorer";

export function computeTotalScore(
  categoryScores: CategoryScore[],
  floorCheck: FloorCheckResult,
): TotalScore {
  const rawScore = categoryScores.reduce(
    (sum, cs) => sum + (cs.score * cs.weight) / 100,
    0,
  );

  const roundedRaw = roundTo2(rawScore);

  if (floorCheck.triggered && floorCheck.capValue !== null) {
    const capped = Math.min(roundedRaw, floorCheck.capValue);
    return {
      rawScore: roundedRaw,
      score: capped,
      floorTriggered: roundedRaw > floorCheck.capValue,
      floorReason: roundedRaw > floorCheck.capValue
        ? `Floor cap applied: ${floorCheck.triggeringRules.join(", ")}`
        : null,
    };
  }

  return {
    rawScore: roundedRaw,
    score: roundedRaw,
    floorTriggered: false,
    floorReason: null,
  };
}
