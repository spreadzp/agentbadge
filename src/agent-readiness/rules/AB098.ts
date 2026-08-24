import type { AgentReadinessRule } from "../rule.schema";
export const AB098: AgentReadinessRule = {
  rule_id: "AB-098", version: "1.0.0",
  name: "Content-Security-Policy header",
  category: "infrastructure", severity: "high", counted_in_score: true,
  check: {
    type: "header_check",
    target: "/",
    sources: ["infrastructure"],
    match_keys: ["content-security-policy"],
  },
  fix: {
    eligible: false, type: "none",
    note: "Set Content-Security-Policy header to prevent XSS and data injection attacks",
  },
};
