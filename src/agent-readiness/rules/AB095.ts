import type { AgentReadinessRule } from "../rule.schema";
export const AB095: AgentReadinessRule = {
  rule_id: "AB-095", version: "1.0.0",
  name: "AT Protocol DID declared",
  category: "identity", severity: "low", counted_in_score: false,
  check: { type: "http_fetch", target: "/.well-known/atproto-did", sources: ["identity"] },
  fix: { eligible: true, type: "assisted", note: "Publish /.well-known/atproto-did with your DID identifier" },
};
