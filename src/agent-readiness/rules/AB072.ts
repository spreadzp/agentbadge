import type { AgentReadinessRule } from "../rule.schema";
export const AB072: AgentReadinessRule = {
  rule_id: "AB-072", version: "1.0.0",
  name: "Bazaar extension in L402 402 header",
  category: "bazaar", severity: "medium", counted_in_score: true,
  check: { type: "header_check", target: "/passport/request", sources: ["l402"], match_keys: ["payment-required"] },
  fix: { eligible: false, type: "none", note: "Include bazaar.discoverable=true in Payment-Required header (base64 JSON)" },
};
