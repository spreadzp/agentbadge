import type { AgentReadinessRule } from "../rule.schema";
export const AB033: AgentReadinessRule = {
  rule_id: "AB-033", version: "1.0.0",
  name: "Recipient (payTo) specified",
  category: "payments", severity: "high", counted_in_score: true,
  check: { type: "content_parse", target: "/.well-known/x402.json", sources: ["x402"] },
  fix: { eligible: true, type: "deterministic", note: "Add payTo field to x402.json" },
};
