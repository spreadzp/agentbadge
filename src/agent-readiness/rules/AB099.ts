import type { AgentReadinessRule } from "../rule.schema";
export const AB099: AgentReadinessRule = {
  rule_id: "AB-099", version: "1.0.0",
  name: "Referrer-Policy header",
  category: "infrastructure", severity: "low", counted_in_score: true,
  check: {
    type: "header_check",
    target: "/",
    sources: ["infrastructure"],
    match_keys: ["referrer-policy"],
  },
  fix: {
    eligible: true, type: "deterministic",
    note: "Set Referrer-Policy: strict-origin-when-cross-origin to control referrer information leakage",
  },
};
