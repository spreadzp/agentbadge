import type { AgentReadinessRule } from "../rule.schema";
export const AB036: AgentReadinessRule = {
  rule_id: "AB-036", version: "1.0.0",
  name: "Bazaar discoverable",
  category: "bazaar", severity: "medium", counted_in_score: true,
  check: { type: "content_parse", target: "/.well-known/x402.json", sources: ["x402"] },
  fix: { eligible: true, type: "deterministic", note: "Add extensions.bazaar.discoverable: true to x402.json" },
};
