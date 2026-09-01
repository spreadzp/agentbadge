import { PILLAR_LABELS, PILLARS } from "../../scoring/pillar-map";
import type { PillarScore } from "../../scoring/scoring-types";

export function weightScaledScore(ps: PillarScore): number {
  return Math.round((ps.score * ps.weight) / 100);
}

export function pillarLabel(key: string): string {
  return PILLAR_LABELS[key as keyof typeof PILLAR_LABELS] ?? key;
}

export function orderedPillars(
  pillars: Record<string, PillarScore>,
): { key: string; score: PillarScore }[] {
  const result: { key: string; score: PillarScore }[] = [];
  for (const key of PILLARS) {
    const ps = pillars[key];
    if (ps) result.push({ key, score: ps });
  }
  return result;
}
