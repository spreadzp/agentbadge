import type { AgentReadinessRule } from "../rule.schema";

export const AB057: AgentReadinessRule = {
  rule_id: "AB-057",
  version: "1.0.0",
  name: "DID document available",
  category: "identity",
  severity: "low",
  counted_in_score: false,
  check: { type: "http_fetch", target: "/.well-known/did.json", sources: ["identity"] },
  fix: { eligible: false, type: "assisted", note: "Publish a DID document at /.well-known/did.json" },
};
