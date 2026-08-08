import type { AgentReadinessRule } from "../rule.schema";
export const AB037: AgentReadinessRule = {
  rule_id: "AB-037", version: "1.0.0",
  name: "Bazaar service declared",
  category: "bazaar", severity: "low", counted_in_score: true,
  check: { type: "content_parse", target: "/.well-known/x402.json", sources: ["x402"] },
  fix: { eligible: true, type: "assisted", note: "Add at least one service with bazaar metadata to x402.json" },
};
