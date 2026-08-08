import type { AgentReadinessRule } from "../rule.schema";
export const AB040: AgentReadinessRule = {
  rule_id: "AB-040", version: "1.0.0",
  name: "OpenAPI paths defined",
  category: "openapi", severity: "medium", counted_in_score: true,
  check: { type: "schema_validation", target: "/openapi.json", sources: ["openapi_standard"] },
  fix: { eligible: false, type: "assisted", note: "Add paths to OpenAPI spec" },
};
