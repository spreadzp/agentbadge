import type { AgentReadinessRule } from "../rule.schema";
export const AB119: AgentReadinessRule = {
  rule_id: "AB-119", version: "1.0.0",
  name: "OAuth token endpoint reachable",
  category: "verification", severity: "high", counted_in_score: true,
  check: {
    type: "http_probe",
    sources: ["auth_probe"],
  },
  fix: {
    eligible: false, type: "none",
    note: "Ensure the OAuth token endpoint is reachable and accepts client_credentials grant",
  },
};
