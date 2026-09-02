import type { AgentReadinessRule } from "../rule.schema";

export const AB150: AgentReadinessRule = {
  rule_id: "AB-150",
  version: "1.0.0",
  name: "Pricing discoverability",
  category: "pricing",
  severity: "high",
  counted_in_score: true,
  check: {
    type: "semantic_validation",
    sources: ["guide", "openapi", "llms", "pricing"],
    semantic: "pricing_discoverability",
  },
  fix: {
    eligible: false,
    type: "assisted",
    note: "Add machine-readable pricing to your agent guide, pricing.json, or OpenAPI x-pricing extension",
  },
};
