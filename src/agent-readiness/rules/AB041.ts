import type { AgentReadinessRule } from "../rule.schema";
export const AB041: AgentReadinessRule = {
  rule_id: "AB-041", version: "1.0.0",
  name: "OpenAPI paths reachable",
  category: "openapi", severity: "medium", counted_in_score: true,
  check: { type: "http_probe", target: "/openapi.json", sources: ["openapi_standard"] },
  fix: { eligible: false, type: "none", note: "Ensure all paths in OpenAPI spec resolve to real routes" },
};
