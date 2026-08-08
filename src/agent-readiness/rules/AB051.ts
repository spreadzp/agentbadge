import type { AgentReadinessRule } from "../rule.schema";
export const AB051: AgentReadinessRule = {
  rule_id: "AB-051", version: "1.0.0",
  name: "WebMCP form annotations",
  category: "webmcp", severity: "low", counted_in_score: true,
  check: { type: "content_parse", target: "/", sources: ["webmcp"] },
  fix: { eligible: false, type: "assisted", note: "Add data-mcp attributes to HTML forms" },
};
