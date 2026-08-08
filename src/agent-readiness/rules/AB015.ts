import type { AgentReadinessRule } from "../rule.schema";

export const AB015: AgentReadinessRule = {
  rule_id: "AB-015",
  version: "1.0.0",
  name: "Content negotiation — agent UA gets non-HTML",
  category: "content_negotiation",
  severity: "medium",
  counted_in_score: true,
  check: {
    type: "http_probe",
    target: "/",
    sources: ["content_negotiation"],
  },
  fix: {
    eligible: true,
    type: "assisted",
    note: "Configure server to return text/markdown or text/plain for agent User-Agent strings",
  },
};
