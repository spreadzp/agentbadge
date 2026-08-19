import type { AgentReadinessRule } from "../rule.schema";
export const AB075: AgentReadinessRule = {
  rule_id: "AB-075", version: "1.0.0",
  name: "A2A Agent Card verified",
  category: "actionability", severity: "medium", counted_in_score: true,
  check: { type: "schema_validation", target: "/.well-known/agent-card.json", sources: ["a2a"] },
  fix: { eligible: true, type: "assisted", note: "Ensure agent-card.json has name, description, url, and capabilities fields" },
};
