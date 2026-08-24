import type { AgentReadinessRule } from "../rule.schema";
export const AB116: AgentReadinessRule = {
  rule_id: "AB-116", version: "1.0.0",
  name: "Well-known MCP descriptor",
  category: "webmcp", severity: "medium", counted_in_score: true,
  check: {
    type: "http_fetch",
    sources: ["mcp"],
    target: "/.well-known/mcp.json",
  },
  fix: {
    eligible: false, type: "none",
    note: "Publish MCP server descriptor at /.well-known/mcp.json with server info, transport type, and tool registry",
  },
};
