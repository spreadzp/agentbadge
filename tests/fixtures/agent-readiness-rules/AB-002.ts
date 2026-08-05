import type { AgentReadinessRule } from "../../../src/agent-readiness/rule.schema";

export const AB002: AgentReadinessRule = {
  rule_id: "AB-002",
  version: "1.0.0",
  name: "sitemap.xml present",
  category: "discovery",
  severity: "low",
  counted_in_score: true,
  check: {
    type: "http_fetch",
    target: "/sitemap.xml",
  },
  fix: {
    eligible: true,
    type: "deterministic",
    note: "Scaffold a minimal sitemap from crawled links if known; otherwise a stub with a comment for the owner",
  },
};
