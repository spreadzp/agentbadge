import type { AgentReadinessRule } from "../rule.schema";
export const AB044: AgentReadinessRule = {
  rule_id: "AB-044", version: "1.0.0",
  name: "OpenAPI title present",
  category: "openapi", severity: "low", counted_in_score: true,
  check: { type: "content_parse", target: "/openapi.json", sources: ["openapi_standard"] },
  fix: { eligible: true, type: "deterministic", note: "Add info.title to OpenAPI spec" },
};
