import type { AgentReadinessRule } from "../rule.schema";
export const AB097: AgentReadinessRule = {
  rule_id: "AB-097", version: "1.0.0",
  name: "Android Asset Links declared",
  category: "identity", severity: "low", counted_in_score: false,
  check: { type: "http_fetch", target: "/.well-known/assetlinks.json", sources: ["identity"] },
  fix: { eligible: true, type: "assisted", note: "Publish /.well-known/assetlinks.json with Android app asset links for deep linking" },
};
