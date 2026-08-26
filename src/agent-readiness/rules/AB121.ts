import type { AgentReadinessRule } from "../rule.schema";
export const AB121: AgentReadinessRule = {
  rule_id: "AB-121", version: "1.0.0",
  name: "Token response valid format",
  category: "verification", severity: "medium", counted_in_score: true,
  check: {
    type: "schema_validation",
    sources: ["auth_probe"],
  },
  fix: {
    eligible: false, type: "none",
    note: "Ensure the token endpoint returns a valid JSON response with access_token field",
  },
};
