import type { AgentReadinessRule } from "../rule.schema";

export const AB149: AgentReadinessRule = {
  rule_id: "AB-149",
  version: "1.0.0",
  name: "Error semantics",
  category: "error_semantics",
  severity: "high",
  counted_in_score: true,
  check: {
    type: "semantic_validation",
    sources: ["openapi"],
    semantic: "openapi_error_schemas",
  },
  fix: {
    eligible: false,
    type: "assisted",
    note: "Declare 4xx/5xx responses with content schemas and descriptions; consider RFC 9457 application/problem+json",
  },
};
