import type { Assertion } from "../rule-engine/assertion-builder";
import type { AgentReadinessRule } from "../rule.schema";
import type { Category, Pillar, GapType } from "../shared.schema";
import { CATEGORY_TO_PILLAR } from "../scoring/pillar-map";
import { DEFAULT_GAP_TYPE_BY_CATEGORY, FIX_HINT_BY_GAP_TYPE, type Gap } from "./gap-types";

// ─── Gap Engine: deriveGaps() ─────────────────────────────────────────────────
// Pure function over assertions + rules. No I/O, no LLM.
// Spec v0.5 §8: GAP → gap candidate; CONFLICT → evidence gap; others → no gap.

function ruleGapType(rule: AgentReadinessRule | undefined, category: Category): GapType {
  if (rule?.gap_type) return rule.gap_type;
  return DEFAULT_GAP_TYPE_BY_CATEGORY[category];
}

function resolveTitle(assertion: Assertion): string {
  return assertion.display_question || assertion.claim || assertion.name || assertion.rule_id;
}

function resolveDescription(assertion: Assertion): string {
  const claim = assertion.claim || assertion.name || "";
  const reason = assertion.reason || "";
  if (claim && reason) return `${claim}; ${reason}`;
  return claim || reason || "";
}

export function deriveGaps(
  assertions: Assertion[],
  rules: AgentReadinessRule[],
): Gap[] {
  const ruleMap = new Map(rules.map((r) => [r.rule_id, r]));

  // Collect gap candidates from GAP and CONFLICT assertions
  const gapMap = new Map<string, Gap>();

  for (const assertion of assertions) {
    const isGap = assertion.status === "GAP";
    const isConflict = assertion.status === "CONFLICT";
    if (!isGap && !isConflict) continue;

    const category = assertion.category as Category;
    const rule = ruleMap.get(assertion.rule_id);
    const type: GapType = isConflict ? "evidence" : ruleGapType(rule, category);
    const gapKey = `${type}:${category}`;

    const existing = gapMap.get(gapKey);
    if (existing) {
      // Accumulate
      existing.related_rules.push(assertion.rule_id);
      existing.frequency += 1;
      // Collect evidence refs
      if (assertion.evidence.length > 0) {
        existing.evidence_refs.push(...assertion.evidence.map((e) => `${assertion.rule_id}:${e.type}`));
      }
      // Keep first non-empty title
      if (!existing.title || existing.title === existing.related_rules[0]) {
        const title = resolveTitle(assertion);
        if (title) existing.title = title;
      }
      // Append description
      const desc = resolveDescription(assertion);
      if (desc) existing.description = existing.description ? `${existing.description}; ${desc}` : desc;
    } else {
      const pillar: Pillar = CATEGORY_TO_PILLAR[category];
      const gap: Gap = {
        gap_id: `gap:${type}:${category}`,
        type,
        title: resolveTitle(assertion),
        description: resolveDescription(assertion),
        priority: "LOW", // placeholder — 96-4 computes
        priority_reason: "", // placeholder — 96-4 computes
        related_rules: [assertion.rule_id],
        evidence_refs: assertion.evidence.length > 0
          ? assertion.evidence.map((e) => `${assertion.rule_id}:${e.type}`)
          : [],
        fix_hint: FIX_HINT_BY_GAP_TYPE[type],
        fix_artifacts: [], // 96-5 fills
        pillar,
        category,
        frequency: 1,
      };
      gapMap.set(gapKey, gap);
    }
  }

  // Sort by category name (deterministic); priority sort added in 96-4
  const gaps = Array.from(gapMap.values()).sort((a, b) => a.category.localeCompare(b.category));
  return gaps;
}

// ─── summarizeGaps() ──────────────────────────────────────────────────────────

export interface GapSummary {
  total: number;
  by_priority: {
    CRITICAL: number;
    HIGH: number;
    MEDIUM: number;
    LOW: number;
  };
  by_type: {
    documentation: number;
    semantic: number;
    capability: number;
    evidence: number;
  };
}

export function summarizeGaps(gaps: Gap[]): GapSummary {
  const summary: GapSummary = {
    total: gaps.length,
    by_priority: { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 },
    by_type: { documentation: 0, semantic: 0, capability: 0, evidence: 0 },
  };
  for (const gap of gaps) {
    summary.by_priority[gap.priority]++;
    summary.by_type[gap.type]++;
  }
  return summary;
}
