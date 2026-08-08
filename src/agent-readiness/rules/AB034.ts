import type { AgentReadinessRule } from "../rule.schema";
export const AB034: AgentReadinessRule = {
  rule_id: "AB-034", version: "1.0.0",
  name: "Payment terms (amount) specified",
  category: "payments", severity: "medium", counted_in_score: true,
  check: { type: "content_parse", target: "/.well-known/x402.json", sources: ["x402"] },
  fix: { eligible: true, type: "deterministic", note: "Add amount field to service entries in x402.json" },
};
