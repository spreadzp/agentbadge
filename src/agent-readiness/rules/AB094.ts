import type { AgentReadinessRule } from "../rule.schema";
export const AB094: AgentReadinessRule = {
  rule_id: "AB-094", version: "1.0.0",
  name: "Nostr NIP-05 verification",
  category: "identity", severity: "low", counted_in_score: false,
  check: { type: "http_fetch", target: "/.well-known/nostr.json", sources: ["identity"] },
  fix: { eligible: true, type: "assisted", note: "Publish /.well-known/nostr.json with names mapping for NIP-05 verification" },
};
