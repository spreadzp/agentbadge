import type { AgentReadinessRule } from "../rule.schema";
export const AB031: AgentReadinessRule = {
  rule_id: "AB-031", version: "1.0.0",
  name: "x402 challenge decodable",
  category: "payments", severity: "high", counted_in_score: true,
  check: { type: "content_parse", target: "/passport/request", sources: ["x402"] },
  fix: { eligible: false, type: "none", note: "Ensure Payment-Required header contains valid base64-encoded JSON" },
};
