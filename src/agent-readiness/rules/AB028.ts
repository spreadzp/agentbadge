import type { AgentReadinessRule } from "../rule.schema";

export const AB028: AgentReadinessRule = {
  rule_id: "AB-028",
  version: "1.0.0",
  name: "Vary: Accept header set",
  category: "content_negotiation",
  severity: "low",
  counted_in_score: true,
  check: {
    type: "header_check",
    target: "/",
    sources: ["content_negotiation"],
  },
  fix: {
    eligible: true,
    type: "deterministic",
    note: "Add Vary: Accept header to responses that support content negotiation",
  },
};
