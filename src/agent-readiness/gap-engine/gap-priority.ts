import type { Gap } from "./gap-types";
import type { Pillar } from "../shared.schema";
import { PILLAR_CATEGORIES } from "../scoring/pillar-map";
import type { CategoryWeights } from "../scoring/scoring-types";

// ─── Prioritization Model (spec v0.5 §8.2) ────────────────────────────────────
// Pure function. All inputs from manifest data (weights) + rule severities.
// Quartiles: nearest-rank definition. For a pillar with N categories sorted desc,
// top quartile = first ceil(N*0.25) entries, bottom quartile = last ceil(N*0.25) entries.

export interface RuleSeverity {
  rule_id: string;
  severity: "critical" | "high" | "medium" | "low";
}

const PRIORITY_LEVELS = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
type PriorityLevel = (typeof PRIORITY_LEVELS)[number];

function severityToPriority(severity: string): PriorityLevel {
  switch (severity) {
    case "critical": return "CRITICAL";
    case "high": return "HIGH";
    case "medium": return "MEDIUM";
    default: return "LOW";
  }
}

function priorityToLevel(p: PriorityLevel): number {
  return PRIORITY_LEVELS.indexOf(p);
}

function levelToPriority(level: number): PriorityLevel {
  return PRIORITY_LEVELS[Math.max(0, Math.min(3, level))];
}

function clampPriority(level: number): PriorityLevel {
  return levelToPriority(level);
}

/**
 * Compute pillar quartiles using nearest-rank definition.
 * Returns the set of categories in top and bottom quartiles.
 */
function pillarQuartiles(
  weights: CategoryWeights,
  pillar: Pillar,
): { topQuartile: Set<string>; bottomQuartile: Set<string> } {
  const cats = PILLAR_CATEGORIES[pillar];
  const n = cats.length;
  if (n <= 1) {
    // Single category — no quartile adjustment
    return { topQuartile: new Set(), bottomQuartile: new Set() };
  }

  // Sort categories by weight descending
  const sorted = [...cats].sort((a, b) => (weights[b] ?? 0) - (weights[a] ?? 0));

  // Nearest-rank: Q1 at ceil(n*0.25), Q3 at ceil(n*0.75)
  const q1Count = Math.ceil(n * 0.25);

  // Top quartile = first q1Count entries (highest weights)
  const topQuartile = new Set(sorted.slice(0, q1Count));
  // Bottom quartile = last q1Count entries (lowest weights)
  const bottomQuartile = new Set(sorted.slice(n - q1Count));

  return { topQuartile, bottomQuartile };
}

export function prioritizeGaps(
  gaps: Gap[],
  weights: CategoryWeights,
  rules: RuleSeverity[],
): Gap[] {
  const ruleSeverityMap = new Map(rules.map((r) => [r.rule_id, r.severity]));

  // Pre-compute quartiles per pillar
  const quartileCache = new Map<Pillar, { topQuartile: Set<string>; bottomQuartile: Set<string> }>();
  for (const pillar of ["discovery", "understandability", "executability", "verifiability"] as Pillar[]) {
    quartileCache.set(pillar, pillarQuartiles(weights, pillar));
  }

  const prioritized = gaps.map((gap) => {
    // Get severities of contributing rules
    const severities = gap.related_rules
      .map((rid) => ruleSeverityMap.get(rid))
      .filter((s): s is "critical" | "high" | "medium" | "low" => s !== undefined);

    // Base = max contributing severity
    const maxSeverity: "critical" | "high" | "medium" | "low" = severities.length > 0
      ? severities.reduce((max, s) => {
        const order: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };
        return order[s] > order[max] ? s : max;
      })
      : "low";

    const basePriority = severityToPriority(maxSeverity);
    let level = priorityToLevel(basePriority);

    // Impact = category weight share within pillar
    const pillar = gap.pillar;
    const pillarCats = PILLAR_CATEGORIES[pillar];
    const pillarTotal = pillarCats.reduce((sum, cat) => sum + (weights[cat] ?? 0), 0);
    const catWeight = weights[gap.category] ?? 0;
    const impactShare = pillarTotal > 0 ? catWeight / pillarTotal : 0;

    const { topQuartile, bottomQuartile } = quartileCache.get(pillar)!;
    let impactAdjustment = 0;
    let quartileLabel = "middle (no adjustment)";
    if (topQuartile.has(gap.category)) {
      impactAdjustment = 1;
      quartileLabel = "top quartile (+1)";
    } else if (bottomQuartile.has(gap.category)) {
      impactAdjustment = -1;
      quartileLabel = "bottom quartile (-1)";
    }

    // Apply impact adjustment
    level += impactAdjustment;

    // Frequency bump
    const freq = gap.frequency;
    let freqAdjustment = 0;
    if (freq >= 3) {
      freqAdjustment = 1;
    }
    level += freqAdjustment;

    // Critical floor: any contributing rule with severity critical → CRITICAL, never lowered
    const hasCritical = severities.includes("critical");
    let floorApplied = false;
    if (hasCritical) {
      level = priorityToLevel("CRITICAL");
      floorApplied = true;
    }

    // Clamp
    const clampedPriority = clampPriority(level);
    const wasClamped = level < 0 || level > 3;

    // Build priority_reason
    const reasonParts: string[] = [
      `severity=${maxSeverity} (base ${basePriority})`,
      `impact ${impactShare.toFixed(3)} ${quartileLabel}`,
      `frequency=${freq}${freqAdjustment > 0 ? " (+1)" : ""}`,
    ];
    if (floorApplied) {
      reasonParts.push("floor=CRITICAL (applied)");
    }
    if (wasClamped && !floorApplied) {
      reasonParts.push(`clamp=${clampedPriority}`);
    }
    reasonParts.push(`final=${clampedPriority}`);

    return {
      ...gap,
      priority: clampedPriority,
      priority_reason: reasonParts.join("; "),
    };
  });

  // Sort by priority desc, then category asc
  prioritized.sort((a, b) => {
    const priorityDiff = priorityToLevel(b.priority) - priorityToLevel(a.priority);
    if (priorityDiff !== 0) return priorityDiff;
    return a.category.localeCompare(b.category);
  });

  return prioritized;
}
