import type { AgentReadinessRule } from "../rule.schema";
export const AB085: AgentReadinessRule = {
  rule_id: "AB-085", version: "1.0.0",
  name: "MCP server name present",
  category: "actionability", severity: "medium", counted_in_score: true,
  check: { type: "json_rpc", target: "/mcp", sources: ["mcp_probe"] },
  fix: { eligible: true, type: "assisted", note: "Return serverInfo.name in MCP initialize response" },
};
