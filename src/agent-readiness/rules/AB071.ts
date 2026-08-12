import type { AgentReadinessRule } from "../rule.schema";
export const AB071: AgentReadinessRule = {
  rule_id: "AB-071", version: "1.0.0",
  name: "L402 macaroon and invoice in challenge",
  category: "payments", severity: "high", counted_in_score: true,
  check: { type: "content_parse", target: "/passport/request", sources: ["l402"] },
  fix: { eligible: false, type: "none", note: "Include macaroon and invoice fields in L402 challenge JSON body" },
};
