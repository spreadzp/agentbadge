import type { RuleEngineResult } from "./rule-engine/rule-engine";
import type { Assertion } from "./rule-engine/assertion-builder";
import { RULE_DESCRIPTIONS, CATEGORY_DESCRIPTIONS } from "./rule-descriptions";

export interface ScanReport {
  url: string;
  score: number;
  grade: string;
  total_rules: number;
  verified: number;
  missing: number;
  not_applicable: number;
  skipped: number;
  categories: CategoryReport[];
  top_missing: MissingRule[];
  summary: string;
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
  const missing = assertions.filter((a) => a.status === "MISSING").length;
  const notApplicable = assertions.filter((a) => a.status === "NOT_APPLICABLE").length;
  const skipped = assertions.filter((a) => a.status === "SKIPPED").length;
  const score = total > 0 ? Math.round((verified / total) * 100) : 0;

  const categoryMap = new Map<string, { verified: number; missing: number; total: number }>();

  for (const a of assertions) {
    const cat = a.category || "unknown";
    if (!categoryMap.has(cat)) {
      categoryMap.set(cat, { verified: 0, missing: 0, total: 0 });
    }
    const entry = categoryMap.get(cat)!;
    entry.total++;
    if (a.status === "VERIFIED" || a.status === "INFERRED") entry.verified++;
    if (a.status === "MISSING") entry.missing++;
  }

  const categories: CategoryReport[] = [];
  for (const [cat, counts] of categoryMap) {
    const desc = CATEGORY_DESCRIPTIONS[cat as keyof typeof CATEGORY_DESCRIPTIONS];
    categories.push({
      category: cat,
      name: desc?.title ?? cat,
      icon: desc?.icon ?? "📋",
      total: counts.total,
      verified: counts.verified,
      missing: counts.missing,
      completeness_pct: counts.total > 0 ? Math.round((counts.verified / counts.total) * 100) : 0,
    });
  }

  const missingAssertions = assertions
    .filter((a) => a.status === "MISSING")
    .map((a) => {
      const desc = RULE_DESCRIPTIONS.find((r) => r.rule_id === a.rule_id);
      return {
        rule_id: a.rule_id,
        title: desc?.title ?? a.rule_id,
        category: a.category || "unknown",
        hint: (a as any).hint ?? (a as any).fix_hint ?? "See rule documentation for fix instructions.",
        effort_hint: desc?.effort_hint ?? "moderate",
        estimated_cost: desc?.estimated_cost ?? "$10-50",
      } as MissingRule;
    })
    .sort((a, b) => {
      const effortOrder: Record<string, number> = { quick: 0, moderate: 1, complex: 2 };
      return (effortOrder[a.effort_hint] ?? 1) - (effortOrder[b.effort_hint] ?? 1);
    })
    .slice(0, 10);

  const grade = score >= 80 ? "A" : score >= 60 ? "B" : score >= 40 ? "C" : score >= 20 ? "D" : "F";

  const summary = `Your site scored ${score}/100 (${grade} grade). ${verified} of ${total} rules passed, ${missing} need attention, ${notApplicable} not applicable.`;

  return {
    url,
    score,
    grade,
    total_rules: total,
    verified,
    missing,
    not_applicable: notApplicable,
    skipped,
    categories: categories.sort((a, b) => b.completeness_pct - a.completeness_pct),
    top_missing: missingAssertions,
    summary,
  };
}
