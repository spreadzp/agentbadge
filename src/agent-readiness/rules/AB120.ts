import type { AgentReadinessRule } from "../rule.schema";
export const AB120: AgentReadinessRule = {
  rule_id: "AB-120", version: "1.0.0",
  name: "Authenticated endpoint callable",
  category: "verification", severity: "high", counted_in_score: true,
  check: {
    type: "http_probe",
    sources: ["auth_probe"],
  },
  fix: {
    eligible: false, type: "none",
    note: "Ensure protected endpoints accept the OAuth bearer token and return 200",
  },
};
