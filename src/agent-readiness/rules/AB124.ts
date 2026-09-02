import type { AgentReadinessRule } from "../rule.schema";
export const AB124: AgentReadinessRule = {
  rule_id: "AB-124", version: "1.0.0",
  name: "Response content-type present",
  category: "verification", severity: "medium", counted_in_score: true,
  check: {
    type: "http_probe",
    sources: ["endpoint_probe"],
  },
  fix: {
    eligible: false, type: "none",
    note: "Ensure probed endpoints return a content-type header in the response",
  },
};
