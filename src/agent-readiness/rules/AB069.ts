import type { AgentReadinessRule } from "../rule.schema";

export const AB069: AgentReadinessRule = {
  rule_id: "AB-069",
  version: "1.0.0",
  name: "WebMCP browser-side tools (document.modelContext)",
  category: "webmcp",
  severity: "medium",
  counted_in_score: true,
  check: {
    type: "content_parse",
    target: "/",
    sources: ["webmcp_runtime"],
  },
  fix: {
    eligible: true,
    type: "assisted",
    note: "Add document.modelContext.registerTool() with tool definitions to page HTML",
  },
};
