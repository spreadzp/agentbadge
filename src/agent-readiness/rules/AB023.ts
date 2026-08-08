import type { AgentReadinessRule } from "../rule.schema";

export const AB023: AgentReadinessRule = {
  rule_id: "AB-023",
  version: "1.0.0",
  name: "MCP auth discovery resolves",
  category: "bot_auth",
  severity: "medium",
  counted_in_score: true,
  check: {
    type: "http_fetch",
    target: "/.well-known/oauth-authorization-server",
    sources: ["mcp"],
  },
  fix: {
    eligible: true,
    type: "assisted",
    note: "Add OAuth discovery metadata at /.well-known/oauth-authorization-server",
  },
};
