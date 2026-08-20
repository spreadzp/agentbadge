import type { AgentReadinessRule } from "../rule.schema";
export const AB092: AgentReadinessRule = {
  rule_id: "AB-092", version: "1.0.0",
  name: "Schema.org types valid",
  category: "documentation", severity: "low", counted_in_score: true,
  check: { type: "schema_validation", target: "/", sources: ["homepage_meta"] },
  fix: { eligible: true, type: "assisted", note: "Use valid schema.org types in JSON-LD (Organization, WebSite, Service, Product)" },
};
