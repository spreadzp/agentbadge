import type { AgentReadinessRule } from "../rule.schema";
export const AB088: AgentReadinessRule = {
  rule_id: "AB-088", version: "1.0.0",
  name: "MPP (Machine Payments Protocol) support",
  category: "payments", severity: "medium", counted_in_score: true,
  check: { type: "http_probe", target: "/.well-known/mpp.json", sources: ["x402"] },
  fix: { eligible: true, type: "assisted", note: "Publish /.well-known/mpp.json with protocol and version fields for Machine Payments Protocol support" },
};
