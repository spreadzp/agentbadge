import type { AgentReadinessRule } from "../rule.schema";
export const AB096: AgentReadinessRule = {
  rule_id: "AB-096", version: "1.0.0",
  name: "Apple App Links association",
  category: "identity", severity: "low", counted_in_score: false,
  check: { type: "http_fetch", target: "/.well-known/apple-app-site-association", sources: ["identity"] },
  fix: { eligible: true, type: "assisted", note: "Publish /.well-known/apple-app-site-association with applinks config for iOS universal links" },
};
