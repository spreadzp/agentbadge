import type { AgentReadinessRule } from "../../../src/agent-readiness/rule.schema";

export const AB012: AgentReadinessRule = {
  rule_id: "AB-012",
  version: "1.0.0",
  name: "Structured error schema declared",
  category: "machine_readable",
  severity: "low",
  counted_in_score: true,
  check: {
    type: "schema_validation",
    target: "openapi.components.schemas",
  },
  fix: {
    eligible: false,
    type: "none",
    note: "Cannot safely invent an error contract",
  },
};
