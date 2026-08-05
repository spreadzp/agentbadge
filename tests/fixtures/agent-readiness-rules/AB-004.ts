import type { AgentReadinessRule } from "../../../src/agent-readiness/rule.schema";

export const AB004: AgentReadinessRule = {
  rule_id: "AB-004",
  version: "1.0.0",
  name: "OpenAPI specification present & valid",
  category: "documentation",
  severity: "high",
  counted_in_score: true,
  check: {
    type: "http_fetch",
    target: "/openapi.json",
  },
  fix: {
    eligible: false,
    type: "none",
    note: "Cannot safely generate an OpenAPI spec for an API AgentBadge doesn't own",
  },
};
