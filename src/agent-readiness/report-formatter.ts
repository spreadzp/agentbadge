import type { RuleEngineResult } from "./rule-engine/rule-engine";
import { RULE_DESCRIPTIONS, CATEGORY_DESCRIPTIONS } from "./rule-descriptions";
import { runScoringEngine } from "./scoring/scoring-engine";
import { AGENT_READINESS_RULESET } from "./ruleset";
import { DEFAULT_CATEGORY_WEIGHTS } from "./scoring/scoring-types";
import type { RulesetManifest } from "./scoring/scoring-config";
import { PILLAR_LABELS, PILLAR_QUESTIONS, CATEGORY_TO_PILLAR, PILLARS } from "./scoring/pillar-map";
import type { Pillar } from "./shared.schema";

export interface PillarReport {
  pillar: string;
  label: string;
  question: string;
  weight: number;
  score: number;
  floorTriggered: boolean;
  categories: string[];
}

export interface ScanReport {
  url: string;
  score: number;
  grade: string;
  total_rules: number;
  verified: number;
  missing: number;
  gap: number;
  not_applicable: number;
  skipped: number;
  categories: CategoryReport[];
  top_missing: MissingRule[];
  summary: string;
  pillars: PillarReport[];
  floorTriggered: boolean;
  floorReason: string | null;
}

export interface CategoryReport {
  category: string;
  name: string;
  icon: string;
  total: number;
  verified: number;
  missing: number;
  completeness_pct: number;
}

export interface MissingRule {
  rule_id: string;
  title: string;
  category: string;
  hint: string;
  effort_hint: string;
  estimated_cost: string;
}

export function formatScanReport(url: string, result: RuleEngineResult): ScanReport {
  const assertions = result.assertions;
  const total = assertions.length;
  const verified = assertions.filter((a) => a.status === "VERIFIED" || a.status === "INFERRED").length;
  const missing = assertions.filter((a) => a.status === "GAP").length;
  const gap = missing;
  const notApplicable = assertions.filter((a) => a.status === "NOT_APPLICABLE").length;
  const skipped = assertions.filter((a) => (a.status as string) === "SKIPPED").length;

  const manifest: RulesetManifest = {
    name: AGENT_READINESS_RULESET.name,
    version: AGENT_READINESS_RULESET.version,
    scoring: AGENT_READINESS_RULESET.scoring,
    categoryWeights: DEFAULT_CATEGORY_WEIGHTS,
  };

  const scoreResult = runScoringEngine({ assertions, rulesetManifest: manifest });
  const score = scoreResult.total.score;
  const grade = scoreResult.total.grade;

  const categoryMap = new Map<string, { verified: number; missing: number; total: number }>();
  for (const a of assertions) {
    const cat = a.category || "unknown";
    if (!categoryMap.has(cat)) {
      categoryMap.set(cat, { verified: 0, missing: 0, total: 0 });
    }
    const entry = categoryMap.get(cat)!;
    entry.total++;
    if (a.status === "VERIFIED" || a.status === "INFERRED") entry.verified++;
    if (a.status === "GAP") entry.missing++;
  }

  const categories: CategoryReport[] = [];
  for (const [cat, counts] of categoryMap) {
    const desc = CATEGORY_DESCRIPTIONS[cat as keyof typeof CATEGORY_DESCRIPTIONS];
    const engineCs = scoreResult.categories[cat as keyof typeof scoreResult.categories];
    categories.push({
      category: cat,
      name: desc?.title ?? cat,
      icon: desc?.icon ?? "📋",
      total: counts.total,
      verified: counts.verified,
      missing: counts.missing,
      completeness_pct: engineCs ? Math.round(engineCs.score) : (counts.total > 0 ? Math.round((counts.verified / counts.total) * 100) : 0),
    });
  }

  const pillars: PillarReport[] = PILLARS.map((p: Pillar) => {
    const ps = scoreResult.pillars[p];
    const memberCategories = Object.entries(CATEGORY_TO_PILLAR)
      .filter(([, pillar]) => pillar === p)
      .map(([cat]) => cat);
    return {
      pillar: p,
      label: PILLAR_LABELS[p],
      question: PILLAR_QUESTIONS[p],
      weight: ps.weight,
      score: ps.score,
      floorTriggered: ps.floorTriggered,
      categories: memberCategories,
    };
  });

  const missingAssertions = assertions
    .filter((a) => a.status === "GAP")
    .map((a) => {
      const desc = RULE_DESCRIPTIONS.find((r) => r.rule_id === a.rule_id);
      return {
        rule_id: a.rule_id,
        title: desc?.title ?? a.rule_id,
        category: a.category || "unknown",
        hint: ((a as unknown as Record<string, unknown>).hint ?? (a as unknown as Record<string, unknown>).fix_hint ?? "See rule documentation for fix instructions.") as string,
        effort_hint: desc?.effort_hint ?? "moderate",
        estimated_cost: desc?.estimated_cost ?? "$10-50",
      } as MissingRule;
    })
    .sort((a, b) => {
      const effortOrder: Record<string, number> = { quick: 0, moderate: 1, complex: 2 };
      return (effortOrder[a.effort_hint] ?? 1) - (effortOrder[b.effort_hint] ?? 1);
    })
    .slice(0, 10);

  const summary = `Your site scored ${score}/100 (${grade} grade). ${verified} of ${total} rules passed, ${missing} need attention, ${notApplicable} not applicable.`;

  return {
    url,
    score,
    grade,
    total_rules: total,
    verified,
    missing,
    gap,
    not_applicable: notApplicable,
    skipped,
    categories: categories.sort((a, b) => b.completeness_pct - a.completeness_pct),
    top_missing: missingAssertions,
    summary,
    pillars,
    floorTriggered: scoreResult.total.floorTriggered,
    floorReason: scoreResult.total.floorReason,
  };
}
