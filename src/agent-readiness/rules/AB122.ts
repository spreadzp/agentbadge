import type { AgentReadinessRule } from "../rule.schema";
export const AB122: AgentReadinessRule = {
  rule_id: "AB-122", version: "1.0.0",
  name: "At least one endpoint callable",
  category: "verification", severity: "high", counted_in_score: true,
  check: {
    type: "http_probe",
    sources: ["endpoint_probe"],
  },
  fix: {
    eligible: false, type: "none",
    note: "Ensure at least one API endpoint returns HTTP 200 when probed",
  },
};
