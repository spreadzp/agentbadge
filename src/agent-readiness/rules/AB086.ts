import type { AgentReadinessRule } from "../rule.schema";
export const AB086: AgentReadinessRule = {
  rule_id: "AB-086", version: "1.0.0",
  name: "MCP auth discovery resolves",
  category: "actionability", severity: "medium", counted_in_score: true,
  check: { type: "http_probe", sources: ["mcp_probe"] },
  fix: { eligible: false, type: "assisted", note: "Ensure MCP auth discovery URL is reachable and returns valid metadata" },
};
