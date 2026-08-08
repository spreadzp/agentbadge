import type { AgentReadinessRule } from "../rule.schema";
export const AB030: AgentReadinessRule = {
  rule_id: "AB-030", version: "1.0.0",
  name: "Live 402 response on paid endpoint",
  category: "payments", severity: "high", counted_in_score: true,
  check: { type: "http_probe", target: "/passport/request", sources: ["x402"] },
  fix: { eligible: false, type: "none", note: "Return HTTP 402 with Payment-Required header on paid endpoints" },
};
