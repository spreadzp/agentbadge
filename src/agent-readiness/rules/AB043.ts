import type { AgentReadinessRule } from "../rule.schema";
export const AB043: AgentReadinessRule = {
  rule_id: "AB-043", version: "1.0.0",
  name: "OpenAPI version identified",
  category: "openapi", severity: "low", counted_in_score: true,
  check: { type: "content_parse", target: "/openapi.json", sources: ["openapi_standard"] },
  fix: { eligible: true, type: "deterministic", note: "Add openapi version field to spec" },
};
