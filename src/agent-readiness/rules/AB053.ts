import type { AgentReadinessRule } from "../rule.schema";
export const AB053: AgentReadinessRule = {
  rule_id: "AB-053", version: "1.0.0",
  name: "SVG favicon available",
  category: "documentation", severity: "low", counted_in_score: true,
  check: { type: "http_fetch", target: "/favicon.svg", sources: ["favicon"] },
  fix: { eligible: true, type: "deterministic", note: "Add favicon.svg for crisp rendering at all sizes" },
};
