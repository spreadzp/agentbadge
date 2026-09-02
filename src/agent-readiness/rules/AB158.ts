import type { AgentReadinessRule } from "../rule.schema";

export const AB158: AgentReadinessRule = {
  rule_id: "AB-158",
  version: "1.0.0",
  name: "Capability list declared",
  category: "discovery",
  severity: "medium",
  counted_in_score: true,
  check: {
    type: "semantic_validation",
    sources: ["guide"],
    semantic: "capability_list_declared",
  },
  fix: {
    eligible: false,
    type: "assisted",
    note: "Add a capabilities/endpoints array with per-item descriptions to your agent guide",
  },
};
