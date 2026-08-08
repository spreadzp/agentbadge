import type { AgentReadinessRule } from "../rule.schema";

export const AB056: AgentReadinessRule = {
  rule_id: "AB-056",
  version: "1.0.0",
  name: "WebFinger endpoint available",
  category: "identity",
  severity: "low",
  counted_in_score: false,
  check: { type: "http_fetch", target: "/.well-known/webfinger", sources: ["identity"] },
  fix: { eligible: false, type: "assisted", note: "Implement WebFinger endpoint per RFC 7033" },
};
