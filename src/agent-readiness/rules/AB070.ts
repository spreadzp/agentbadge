import type { AgentReadinessRule } from "../rule.schema";
export const AB070: AgentReadinessRule = {
  rule_id: "AB-070", version: "1.0.0",
  name: "L402 Lightning challenge in 402 response",
  category: "payments", severity: "high", counted_in_score: true,
  check: { type: "header_check", target: "/passport/request", sources: ["l402"], match_keys: ["www-authenticate"] },
  fix: { eligible: false, type: "none", note: "Return 402 with WWW-Authenticate: L402 header containing macaroon and invoice" },
};
