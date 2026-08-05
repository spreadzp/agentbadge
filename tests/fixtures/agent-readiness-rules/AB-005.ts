import type { AgentReadinessRule } from "../../../src/agent-readiness/rule.schema";

export const AB005: AgentReadinessRule = {
  rule_id: "AB-005",
  version: "1.0.0",
  name: "agent-guide.json schema-valid",
  category: "documentation",
  severity: "high",
  counted_in_score: true,
  applicability: {
    condition: "AB-003.status == VERIFIED",
    description: "Only evaluated if AB-003 = VERIFIED (guide exists)",
  },
  check: {
    type: "schema_validation",
    target: "agent-guide.json",
  },
  fix: {
    eligible: true,
    type: "deterministic",
    note: "Deterministic for structural issues (fix malformed JSON syntax if trivially recoverable); assisted for missing required semantic fields",
  },
};
