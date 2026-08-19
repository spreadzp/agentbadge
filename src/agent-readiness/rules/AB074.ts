import type { AgentReadinessRule } from "../rule.schema";
export const AB074: AgentReadinessRule = {
  rule_id: "AB-074", version: "1.0.0",
  name: "A2A Agent Card published",
  category: "actionability", severity: "medium", counted_in_score: true,
  check: { type: "http_fetch", target: "/.well-known/agent-card.json", sources: ["a2a"] },
  fix: { eligible: true, type: "assisted", note: "Publish /.well-known/agent-card.json with agent metadata per A2A spec" },
};
