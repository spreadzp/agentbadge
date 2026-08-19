import type { AgentReadinessRule } from "../rule.schema";
export const AB078: AgentReadinessRule = {
  rule_id: "AB-078", version: "1.0.0",
  name: "OpenAPI x-payment-info declared on paid operations",
  category: "openapi", severity: "medium", counted_in_score: true,
  check: { type: "content_parse", target: "/openapi.json", sources: ["openapi_standard"] },
  fix: { eligible: true, type: "assisted", note: "Add x-payment-info extension to paid operations in OpenAPI spec" },
};
