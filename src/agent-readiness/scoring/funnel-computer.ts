/**
 * Funnel Computer — maps category scores to sequential readiness funnel stages.
 *
 * SLICE-87-1: Pure computation, no external deps.
 */

export interface FunnelStage {
  name: string;
  categories: string[];
  score: number;
  passRate: number;
}

export interface FunnelResult {
  stages: FunnelStage[];
  dropOff: number[];
}

export const FUNNEL_STAGES: ReadonlyArray<{ name: string; categories: string[] }> = [
  { name: "Discovery", categories: ["discovery", "agents_txt", "ai_sitemap"] },
  { name: "Spec Parsed", categories: ["openapi", "machine_readable"] },
  { name: "Auth Described", categories: ["bot_auth", "identity"] },
  { name: "Semantics", categories: ["documentation", "actionability"] },
  { name: "Errors & Examples", categories: ["verification"] },
  { name: "Evidence", categories: ["verification"] },
];

export function computeFunnel(categoryScores: Record<string, number>): FunnelResult {
  const stages: FunnelStage[] = FUNNEL_STAGES.map((stage) => {
    const scores = stage.categories
      .map((c) => categoryScores[c] ?? 0)
      .filter((s) => s !== undefined);
    const avg = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
    return {
      name: stage.name,
      categories: stage.categories,
      score: Math.round(avg),
      passRate: avg / 100,
    };
  });

  const dropOff: number[] = [];
  for (let i = 1; i < stages.length; i++) {
    const prev = stages[i - 1].score;
    const curr = stages[i].score;
    dropOff.push(prev > 0 ? Math.round(((prev - curr) / prev) * 100) : 0);
  }

  return { stages, dropOff };
}
