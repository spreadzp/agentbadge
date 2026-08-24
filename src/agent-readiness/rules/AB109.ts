import type { AgentReadinessRule } from "../rule.schema";
export const AB109: AgentReadinessRule = {
  rule_id: "AB-109", version: "1.0.0",
  name: "Agent Card version 1.0.0+",
  category: "machine_readable", severity: "medium", counted_in_score: true,
  check: {
    type: "schema_validation",
    sources: ["agent_card"],
    match_keys: ["version"],
  },
  fix: {
    eligible: false, type: "none",
    note: "Set version field to '1.0.0' or higher in /.well-known/agent-card.json",
  },
};
