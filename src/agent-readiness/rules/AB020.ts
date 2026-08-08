import type { AgentReadinessRule } from "../rule.schema";

export const AB020: AgentReadinessRule = {
  rule_id: "AB-020",
  version: "1.0.0",
  name: "MCP tools/list responds",
  category: "machine_readable",
  severity: "high",
  counted_in_score: true,
  check: {
    type: "json_rpc",
    target: "/mcp",
    sources: ["mcp"],
  },
  fix: {
    eligible: false,
    type: "none",
    note: "Implement MCP tools/list JSON-RPC method",
  },
};
