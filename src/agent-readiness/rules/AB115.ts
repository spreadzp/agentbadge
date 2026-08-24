import type { AgentReadinessRule } from "../rule.schema";
export const AB115: AgentReadinessRule = {
  rule_id: "AB-115", version: "1.0.0",
  name: "MCP namespace-based tool isolation",
  category: "webmcp", severity: "medium", counted_in_score: true,
  check: {
    type: "json_rpc",
    sources: ["mcp_probe"],
    target: "/mcp",
    match_keys: ["namespaced_tools"],
  },
  fix: {
    eligible: false, type: "none",
    note: "Implement namespace prefixes in MCP tool names (e.g., 'passport.request' instead of 'request_passport') for multi-registry support",
  },
};
