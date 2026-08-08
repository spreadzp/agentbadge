import type { AgentReadinessRule } from "../rule.schema";

export const AB016: AgentReadinessRule = {
  rule_id: "AB-016",
  version: "1.0.0",
  name: "Content negotiation — Accept: JSON returns JSON",
  category: "content_negotiation",
  severity: "medium",
  counted_in_score: true,
  check: {
    type: "header_check",
    target: "/",
    sources: ["content_negotiation"],
  },
  fix: {
    eligible: true,
    type: "assisted",
    note: "Add Accept header content negotiation to return application/json when requested",
  },
};
