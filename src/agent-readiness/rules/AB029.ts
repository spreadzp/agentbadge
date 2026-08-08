import type { AgentReadinessRule } from "../rule.schema";

export const AB029: AgentReadinessRule = {
  rule_id: "AB-029",
  version: "1.0.0",
  name: "Inline content negotiation (no redirect)",
  category: "content_negotiation",
  severity: "low",
  counted_in_score: true,
  check: {
    type: "http_probe",
    target: "/",
    sources: ["content_negotiation"],
  },
  fix: {
    eligible: false,
    type: "assisted",
    note: "Serve negotiated content inline rather than redirecting to separate URLs",
  },
};
