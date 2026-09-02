import type { AgentReadinessRule } from "../rule.schema";

export const AB148: AgentReadinessRule = {
  rule_id: "AB-148",
  version: "1.0.0",
  name: "Request and response examples",
  category: "documentation",
  severity: "medium",
  counted_in_score: true,
  check: {
    type: "semantic_validation",
    sources: ["openapi"],
    semantic: "openapi_examples",
  },
  fix: {
    eligible: false,
    type: "assisted",
    note: "Add example or examples fields to request bodies and response content in your OpenAPI spec",
  },
};
