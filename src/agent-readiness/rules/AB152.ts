import type { AgentReadinessRule } from "../rule.schema";

export const AB152: AgentReadinessRule = {
  rule_id: "AB-152",
  version: "1.0.0",
  name: "Pricing and limits cross-source consistency",
  category: "verification",
  severity: "medium",
  counted_in_score: true,
  check: {
    type: "semantic_validation",
    sources: ["guide", "openapi", "pricing"],
    semantic: "pricing_limits_consistency",
  },
  fix: {
    eligible: false,
    type: "assisted",
    note: "Ensure pricing and rate limit values are consistent across all sources that declare them",
  },
  display_question: "Are pricing and rate limits consistent across all sources?",
};
