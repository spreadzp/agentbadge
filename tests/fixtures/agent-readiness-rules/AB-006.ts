import type { AgentReadinessRule } from "../../../src/agent-readiness/rule.schema";

export const AB006: AgentReadinessRule = {
  rule_id: "AB-006",
  version: "1.0.0",
  name: "MCP server descriptor discoverable",
  category: "documentation",
  severity: "medium",
  counted_in_score: true,
  check: {
    type: "http_fetch",
    target: "/.well-known/mcp.json",
  },
  fix: {
    eligible: false,
    type: "none",
    note: "MCP server implementation is out of scope for AgentBadge to generate",
  },
};
