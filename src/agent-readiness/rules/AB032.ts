import type { AgentReadinessRule } from "../rule.schema";
export const AB032: AgentReadinessRule = {
  rule_id: "AB-032", version: "1.0.0",
  name: "Payment-Required header present",
  category: "payments", severity: "high", counted_in_score: true,
  check: { type: "header_check", target: "/passport/request", sources: ["x402"] },
  fix: { eligible: true, type: "deterministic", note: "Add Payment-Required header to 402 responses" },
};
