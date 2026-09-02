import type { AgentReadinessRule } from "../rule.schema";

export const AB147: AgentReadinessRule = {
  rule_id: "AB-147",
  version: "1.0.0",
  name: "Parameter semantics",
  category: "documentation",
  severity: "medium",
  counted_in_score: true,
  check: {
    type: "semantic_validation",
    sources: ["openapi"],
    semantic: "openapi_parameter_semantics",
  },
  fix: {
    eligible: false,
    type: "assisted",
    note: "Add descriptions and constraints to all parameters in your OpenAPI spec",
  },
};
