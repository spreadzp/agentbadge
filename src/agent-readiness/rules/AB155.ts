import type { AgentReadinessRule } from "../rule.schema";

export const AB155: AgentReadinessRule = {
  rule_id: "AB-155",
  version: "1.0.0",
  name: "Versioning declared",
  category: "versioning",
  severity: "medium",
  counted_in_score: true,
  check: {
    type: "semantic_validation",
    sources: ["openapi", "guide"],
    semantic: "versioning_declared",
  },
  fix: {
    eligible: false,
    type: "assisted",
    note: "Declare API version in OpenAPI info.version and document a deprecation policy (RFC 8594 Sunset header)",
  },
};
