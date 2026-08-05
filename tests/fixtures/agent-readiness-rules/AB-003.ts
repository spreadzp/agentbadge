import type { AgentReadinessRule } from "../../../src/agent-readiness/rule.schema";

export const AB003: AgentReadinessRule = {
  rule_id: "AB-003",
  version: "1.0.0",
  name: "agent-guide.json discoverable",
  category: "discovery",
  severity: "high",
  counted_in_score: true,
  check: {
    type: "http_fetch",
    target: "/.well-known/agent-guide.json",
  },
  fix: {
    eligible: true,
    type: "deterministic",
    note: "Scaffold an empty/skeleton agent-guide.json with required fields present but unfilled (status: draft); does not invent capability data",
  },
};
