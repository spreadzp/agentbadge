import type { AgentReadinessRule } from "../rule.schema";
export const AB076: AgentReadinessRule = {
  rule_id: "AB-076", version: "1.0.0",
  name: "OpenAPI paths reachable (50% threshold)",
  category: "openapi", severity: "medium", counted_in_score: true,
  check: { type: "http_probe", target: "/openapi.json", sources: ["openapi_standard"] },
  fix: { eligible: false, type: "assisted", note: "Ensure declared OpenAPI paths return valid responses" },
};
