import type { AgentReadinessRule } from "../rule.schema";

export const AB059: AgentReadinessRule = {
  rule_id: "AB-059",
  version: "1.0.0",
  name: "Bot auth members valid",
  category: "bot_auth",
  severity: "medium",
  counted_in_score: false,
  check: {
    type: "schema_validation",
    target: "/.well-known/http-message-signatures-directory",
    sources: ["bot-auth"],
  },
  fix: { eligible: false, type: "assisted", note: "Ensure members array has name + publicKeyUrl for each entry" },
};
