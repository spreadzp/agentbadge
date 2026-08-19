import type { AgentReadinessRule } from "../rule.schema";
export const AB093: AgentReadinessRule = {
  rule_id: "AB-093", version: "1.0.0",
  name: "SPT (Stripe Payment Terms) support",
  category: "payments", severity: "low", counted_in_score: true,
  check: { type: "http_probe", target: "/.well-known/spt.json", sources: ["x402"] },
  fix: { eligible: true, type: "assisted", note: "Publish /.well-known/spt.json with stripe_publishable_key for Stripe Payment Terms support" },
};
