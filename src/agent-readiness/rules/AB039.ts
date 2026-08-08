import type { AgentReadinessRule } from "../rule.schema";
export const AB039: AgentReadinessRule = {
  rule_id: "AB-039", version: "1.0.0",
  name: "OpenAPI spec found at standard path",
  category: "openapi", severity: "high", counted_in_score: true,
  check: { type: "http_fetch", target: "/openapi.json", sources: ["openapi_standard"] },
  fix: { eligible: true, type: "deterministic", note: "Serve OpenAPI spec at /openapi.json" },
};
