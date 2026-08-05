import type { AgentReadinessRule } from "../../../src/agent-readiness/rule.schema";

export const AB009: AgentReadinessRule = {
  rule_id: "AB-009",
  version: "1.0.0",
  name: "Capability inference coverage",
  category: "actionability",
  severity: "medium",
  counted_in_score: true,
  check: {
    type: "exact_match",
    sources: ["openapi.operationIds", "agent_guide.capabilities"],
    match_keys: ["operationId"],
  },
  fix: {
    eligible: true,
    type: "assisted",
    note: "Canonical Confirm/Edit/Reject UI case from the scan-result screen",
  },
};
