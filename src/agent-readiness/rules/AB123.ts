import type { AgentReadinessRule } from "../rule.schema";
export const AB123: AgentReadinessRule = {
  rule_id: "AB-123", version: "1.0.0",
  name: "Response matches OpenAPI schema",
  category: "verification", severity: "medium", counted_in_score: true,
  check: {
    type: "http_probe",
    sources: ["endpoint_probe"],
  },
  fix: {
    eligible: false, type: "none",
    note: "Ensure probed endpoint responses match the OpenAPI specification",
  },
};
