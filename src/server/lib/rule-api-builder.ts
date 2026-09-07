import { RULE_DESCRIPTIONS, type RuleDescription } from "../../agent-readiness/rule-descriptions";
import { AGENT_READINESS_RULESET } from "../../agent-readiness/ruleset";
import { CATEGORY_TO_PILLAR } from "../../agent-readiness/scoring/pillar-map";
import type { Category } from "../../agent-readiness/shared.schema";

export interface RuleApiResponse {
  rule_id: string;
  category: string;
  icon: string;
  title: string;
  short_description: string;
  user_value: string;
  wrong_example: string;
  right_example: string;
  effort_hint: "quick" | "moderate" | "complex";
  estimated_cost: string;

  severity: "critical" | "high" | "medium" | "low";
  pillar: string;
  version: string;
  counted_in_score: boolean;
  check: {
    type: string;
    sources?: string[];
    match_keys?: string[];
    target?: string;
  };
  fix: {
    eligible: boolean;
    type: string;
    note?: string;
  };

  checklist_anchor: string;
  checklist_url: string;
  html_url: string;
  json_url: string;
  related_rules: {
    rule_id: string;
    title: string;
    category: string;
  }[];
}

export interface RuleSummary extends Omit<RuleDescription, "severity"> {
  severity: "critical" | "high" | "medium" | "low";
  pillar: string;
  check_type: string;
}

function getRuleDescription(ruleId: string): RuleDescription | undefined {
  return RULE_DESCRIPTIONS.find((r) => r.rule_id === ruleId);
}

export function buildRuleApiResponse(ruleId: string): RuleApiResponse | null {
  const desc = getRuleDescription(ruleId);
  if (!desc) return null;

  const rule = AGENT_READINESS_RULESET.rules.find((r) => r.rule_id === ruleId);
  const pillar = rule?.pillar ?? CATEGORY_TO_PILLAR[desc.category as Category];

  const relatedRules = RULE_DESCRIPTIONS.filter(
    (r) => r.category === desc.category && r.rule_id !== ruleId,
  )
    .slice(0, 10)
    .map((r) => ({ rule_id: r.rule_id, title: r.title, category: r.category }));

  return {
    ...desc,
    severity: (rule?.severity as "critical" | "high" | "medium" | "low") ?? "medium",
    pillar,
    version: rule?.version ?? "1.0.0",
    counted_in_score: rule?.counted_in_score ?? true,
    check: rule
      ? {
        type: rule.check.type,
        sources: (rule.check as { sources?: string[] }).sources,
        match_keys: (rule.check as { match_keys?: string[] }).match_keys,
        target: (rule.check as { target?: string }).target,
      }
      : { type: "http_fetch" },
    fix: rule?.fix
      ? {
        eligible: rule.fix.eligible,
        type: rule.fix.type,
        note: (rule.fix as { note?: string }).note,
      }
      : { eligible: false, type: "manual" },
    checklist_anchor: `#${ruleId}`,
    checklist_url: `/agent-readiness-checklist#${ruleId}`,
    html_url: `/rules/${ruleId}`,
    json_url: `/rules/${ruleId}.json`,
    related_rules: relatedRules,
  };
}

export function buildRuleListApiResponse(): RuleSummary[] {
  return RULE_DESCRIPTIONS.map((desc) => {
    const rule = AGENT_READINESS_RULESET.rules.find((r) => r.rule_id === desc.rule_id);
    const pillar = rule?.pillar ?? CATEGORY_TO_PILLAR[desc.category as Category];
    return {
      ...desc,
      severity: (rule?.severity as "critical" | "high" | "medium" | "low") ?? "medium",
      pillar,
      check_type: rule?.check.type ?? "http_fetch",
    };
  });
}
