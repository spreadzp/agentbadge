import type { AgentReadinessRule } from "../rule.schema";
export const AB077: AgentReadinessRule = {
  rule_id: "AB-077", version: "1.0.0",
  name: "OpenAPI response matches declared spec",
  category: "openapi", severity: "medium", counted_in_score: true,
  check: { type: "cross_evidence", target: "/openapi.json", sources: ["openapi_standard"] },
  fix: { eligible: false, type: "assisted", note: "Ensure API responses match OpenAPI declared content types" },
};
