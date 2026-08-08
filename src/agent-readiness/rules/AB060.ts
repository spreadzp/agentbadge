import type { AgentReadinessRule } from "../rule.schema";

export const AB060: AgentReadinessRule = {
  rule_id: "AB-060",
  version: "1.0.0",
  name: "Bot auth public keys reachable",
  category: "bot_auth",
  severity: "medium",
  counted_in_score: false,
  check: {
    type: "http_probe",
    target: "/.well-known/http-message-signatures-directory",
    sources: ["bot-auth"],
  },
  fix: { eligible: false, type: "assisted", note: "Ensure each publicKeyUrl returns 200 with valid key material" },
};
