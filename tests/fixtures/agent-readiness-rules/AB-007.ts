import type { AgentReadinessRule } from "../../../src/agent-readiness/rule.schema";

export const AB007: AgentReadinessRule = {
  rule_id: "AB-007",
  version: "1.0.0",
  name: "Guide ↔ OpenAPI endpoint consistency",
  category: "actionability",
  severity: "high",
  counted_in_score: true,
  applicability: {
    condition: "AB-003.status == VERIFIED && AB-004.status == VERIFIED",
    description: "Only evaluated if both AB-003 and AB-004 = VERIFIED",
  },
  check: {
    type: "cross_evidence",
    sources: ["openapi", "guide"],
    match_keys: ["method", "path"],
    conflict_when: "sources disagree on method or path",
  },
  fix: {
    eligible: false,
    type: "none",
    note: "A CONFLICT here means the owner's two sources of truth disagree; only a human can resolve which is correct",
  },
};
