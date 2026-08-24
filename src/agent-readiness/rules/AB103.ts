import type { AgentReadinessRule } from "../rule.schema";
export const AB103: AgentReadinessRule = {
  rule_id: "AB-103", version: "1.0.0",
  name: "check_compliance MCP tool available",
  category: "webmcp", severity: "low", counted_in_score: true,
  check: {
    type: "json_rpc",
    sources: ["mcp_probe"],
    target: "/mcp",
    match_keys: ["check_compliance"],
  },
  fix: {
    eligible: false, type: "none",
    note: "Expose a 'check_compliance' MCP tool that allows agents to verify their own readiness",
  },
};
