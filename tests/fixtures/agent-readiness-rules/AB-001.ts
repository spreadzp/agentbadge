import type { AgentReadinessRule } from "../../../src/agent-readiness/rule.schema";

export const AB001: AgentReadinessRule = {
  rule_id: "AB-001",
  version: "1.0.0",
  name: "robots.txt present",
  category: "discovery",
  severity: "low",
  counted_in_score: true,
  check: {
    type: "http_fetch",
    target: "/robots.txt",
  },
  fix: {
    eligible: true,
    type: "deterministic",
    note: "Scaffold a permissive default robots.txt",
  },
};
