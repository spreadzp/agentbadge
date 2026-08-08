import type { AgentReadinessRule } from "../rule.schema";

export const AB019: AgentReadinessRule = {
  rule_id: "AB-019",
  version: "1.0.0",
  name: "Content negotiation — preferred Content-Type (q-values)",
  category: "content_negotiation",
  severity: "low",
  counted_in_score: true,
  check: {
    type: "header_check",
    target: "/",
    sources: ["content_negotiation"],
  },
  fix: {
    eligible: false,
    type: "assisted",
    note: "Implement q-value based content negotiation per RFC 7231",
  },
};
