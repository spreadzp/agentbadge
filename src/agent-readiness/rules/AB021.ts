import type { AgentReadinessRule } from "../rule.schema";

export const AB021: AgentReadinessRule = {
  rule_id: "AB-021",
  version: "1.0.0",
  name: "MCP tools/call responds",
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
    note: "Implement MCP tools/call JSON-RPC method",
  },
};
