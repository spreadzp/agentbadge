import type { AgentReadinessRule } from "../rule.schema";
export const AB038: AgentReadinessRule = {
  rule_id: "AB-038", version: "1.0.0",
  name: "Facilitator specified",
  category: "payments", severity: "medium", counted_in_score: true,
  check: { type: "content_parse", target: "/.well-known/x402.json", sources: ["x402"] },
  fix: { eligible: true, type: "deterministic", note: "Add facilitator URL to x402.json" },
};
