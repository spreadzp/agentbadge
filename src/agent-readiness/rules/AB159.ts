import type { AgentReadinessRule } from "../rule.schema";

export const AB159: AgentReadinessRule = {
  rule_id: "AB-159",
  version: "1.0.0",
  name: "Business constraints documented",
  category: "actionability",
  severity: "medium",
  counted_in_score: true,
  check: {
    type: "semantic_validation",
    sources: ["guide", "llms"],
    semantic: "business_constraints_documented",
  },
  fix: {
    eligible: false,
    type: "assisted",
    note: "Document per-capability constraints (refunds, cancellation windows, limits) in your guide or llms.txt",
  },
};
