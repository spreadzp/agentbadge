import type { Gap } from "./gap-types";
import type { AgentReadinessRule } from "../rule.schema";
import type { FixHint } from "../shared.schema";
import { FIX_HINT_BY_GAP_TYPE } from "./gap-types";

// ─── Fix Readiness Data (spec v0.5 §8.3) ─────────────────────────────────────
// Pure function: annotates gaps with fix_hint + fix_artifacts.
// This is the handoff contract to EPIC-97 (fix pipeline).

const HINT_PRIORITY: Record<FixHint, number> = {
  manual: 3,
  assisted: 2,
  deterministic: 1,
};

/**
 * Conservative wins: manual > assisted > deterministic.
 * Never overpromise autonomy.
 */
function conservativeHint(hints: FixHint[]): FixHint {
  return hints.reduce((max, h) => (HINT_PRIORITY[h] > HINT_PRIORITY[max] ? h : max), "deterministic" as FixHint);
}

/**
 * Derive fix_artifacts from what contributing rules actually checked.
 * Extracts target paths from rule.check.target, strips leading "/".
 * No phantom targets — only artifacts from actual rule checks.
 * capability/evidence gaps → always empty (service change or source resolution).
 */
function deriveArtifacts(gap: Gap, rules: AgentReadinessRule[]): string[] {
  // capability and evidence gaps have no artifact to fix
  if (gap.type === "capability" || gap.type === "evidence") {
    return [];
  }

  const ruleMap = new Map(rules.map((r) => [r.rule_id, r]));
  const artifacts = new Set<string>();

  for (const ruleId of gap.related_rules) {
    const rule = ruleMap.get(ruleId);
    if (!rule) continue;
    const target = rule.check?.target;
    if (!target) continue;
    // Strip leading "/" to get artifact name
    const artifact = target.replace(/^\//, "");
    if (artifact) {
      artifacts.add(artifact);
    }
  }

  return Array.from(artifacts).sort();
}

export function annotateFixReadiness(
  gaps: Gap[],
  rules: AgentReadinessRule[],
): Gap[] {
  const ruleMap = new Map(rules.map((r) => [r.rule_id, r]));

  return gaps.map((gap) => {
    // Gather fix_hint overrides from contributing rules
    const ruleHints: FixHint[] = [];
    for (const ruleId of gap.related_rules) {
      const rule = ruleMap.get(ruleId);
      if (rule?.fix_hint) {
        ruleHints.push(rule.fix_hint);
      }
    }

    // Determine final fix_hint
    let fixHint: FixHint;
    if (ruleHints.length > 0) {
      // Conservative wins when overrides present
      fixHint = conservativeHint(ruleHints);
    } else {
      // Default from gap type
      fixHint = FIX_HINT_BY_GAP_TYPE[gap.type];
    }

    // Derive fix_artifacts from rule check targets
    const fixArtifacts = deriveArtifacts(gap, rules);

    return {
      ...gap,
      fix_hint: fixHint,
      fix_artifacts: fixArtifacts,
    };
  });
}
