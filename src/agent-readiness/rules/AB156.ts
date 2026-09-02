import type { AgentReadinessRule } from "../rule.schema";

export const AB156: AgentReadinessRule = {
  rule_id: "AB-156",
  version: "1.0.0",
  name: "Sandbox environment declared",
  category: "sandbox",
  severity: "medium",
  counted_in_score: true,
  check: {
    type: "semantic_validation",
    sources: ["guide", "openapi", "llms"],
    semantic: "sandbox_declared",
  },
  fix: {
    eligible: false,
    type: "assisted",
    note: "Declare a sandbox/test environment URL in your agent guide or OpenAPI servers",
  },
};
