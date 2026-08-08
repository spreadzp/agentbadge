import type { AgentReadinessRule } from "../rule.schema";
export const AB042: AgentReadinessRule = {
  rule_id: "AB-042", version: "1.0.0",
  name: "Response matches OpenAPI spec",
  category: "openapi", severity: "low", counted_in_score: true,
  check: { type: "schema_validation", target: "/openapi.json", sources: ["openapi_standard"] },
  fix: { eligible: false, type: "assisted", note: "Ensure actual responses match OpenAPI schema definitions" },
};
