import type { AgentReadinessRule } from "../rule.schema";

export const AB058: AgentReadinessRule = {
  rule_id: "AB-058",
  version: "1.0.0",
  name: "Bot auth signatures directory found",
  category: "bot_auth",
  severity: "medium",
  counted_in_score: false,
  check: {
    type: "http_fetch",
    target: "/.well-known/http-message-signatures-directory",
    sources: ["bot-auth"],
  },
  fix: { eligible: false, type: "assisted", note: "Publish signatures directory per RFC 9421" },
};
