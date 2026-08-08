import type { AgentReadinessRule } from "../rule.schema";
export const AB035: AgentReadinessRule = {
  rule_id: "AB-035", version: "1.0.0",
  name: "x402.json discovery published",
  category: "payments", severity: "medium", counted_in_score: true,
  check: { type: "http_fetch", target: "/.well-known/x402.json", sources: ["x402"] },
  fix: { eligible: true, type: "deterministic", note: "Create /.well-known/x402.json with payment discovery metadata" },
};
