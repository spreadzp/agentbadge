import type { AgentReadinessRule } from "../rule.schema";

export const AB146: AgentReadinessRule = {
  rule_id: "AB-146",
  version: "1.0.0",
  name: "Capability descriptions",
  category: "actionability",
  severity: "high",
  counted_in_score: true,
  check: {
    type: "semantic_validation",
    sources: ["openapi"],
    semantic: "openapi_operation_descriptions",
  },
  fix: {
    eligible: false,
    type: "assisted",
    note: "Add description or summary to every operation in your OpenAPI spec",
  },
};
