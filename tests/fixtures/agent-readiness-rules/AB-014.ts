import type { AgentReadinessRule } from "../../../src/agent-readiness/rule.schema";

export const AB014: AgentReadinessRule = {
  rule_id: "AB-014",
  version: "1.0.0",
  name: "llms.txt present",
  category: "discovery",
  severity: "medium",
  counted_in_score: true,
  check: {
    type: "http_fetch",
    target: "/llms.txt",
  },
  fix: {
    eligible: true,
    type: "deterministic",
    note: "Scaffold a minimal llms.txt with project name, description, and links to key documentation",
  },
};
