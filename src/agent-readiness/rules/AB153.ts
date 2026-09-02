import type { AgentReadinessRule } from "../rule.schema";

export const AB153: AgentReadinessRule = {
  rule_id: "AB-153",
  version: "1.0.0",
  name: "Authentication clarity",
  category: "bot_auth",
  severity: "critical",
  counted_in_score: true,
  check: {
    type: "semantic_validation",
    sources: ["openapi", "guide"],
    semantic: "authentication_clarity",
  },
  fix: {
    eligible: false,
    type: "assisted",
    note: "Define securitySchemes in OpenAPI with descriptions, and document how to obtain credentials in your agent guide",
  },
};
