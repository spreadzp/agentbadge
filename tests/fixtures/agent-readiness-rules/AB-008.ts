import type { AgentReadinessRule } from "../../../src/agent-readiness/rule.schema";

export const AB008: AgentReadinessRule = {
  rule_id: "AB-008",
  version: "1.0.0",
  name: "Authentication scheme declared machine-readably",
  category: "actionability",
  severity: "medium",
  counted_in_score: true,
  check: {
    type: "schema_validation",
    target: "openapi.securitySchemes",
  },
  fix: {
    eligible: true,
    type: "assisted",
    note: "AgentBadge can suggest a securityScheme entry inferred from response headers (e.g. WWW-Authenticate), never auto-applied",
  },
};
