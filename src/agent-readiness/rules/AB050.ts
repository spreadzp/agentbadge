import type { AgentReadinessRule } from "../rule.schema";
export const AB050: AgentReadinessRule = {
  rule_id: "AB-050", version: "1.0.0",
  name: "WebMCP manifest found",
  category: "webmcp", severity: "medium", counted_in_score: true,
  check: { type: "http_fetch", target: "/.well-known/webmcp.json", sources: ["webmcp"] },
  fix: { eligible: true, type: "deterministic", note: "Create /.well-known/webmcp.json with MCP tool schemas" },
};
