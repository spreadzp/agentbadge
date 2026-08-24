import type { AgentReadinessRule } from "../rule.schema";
export const AB102: AgentReadinessRule = {
  rule_id: "AB-102", version: "1.0.0",
  name: "MCP tools and REST endpoints parity",
  category: "webmcp", severity: "medium", counted_in_score: true,
  check: {
    type: "cross_evidence",
    sources: ["mcp_probe", "openapi"],
    conflict_when: "mcp_tool_count < openapi_endpoint_count * 0.5",
  },
  fix: {
    eligible: false, type: "none",
    note: "Expose key API endpoints as MCP tools. At least 50% of REST endpoints should have corresponding MCP tools",
  },
};
