import type { AgentReadinessRule } from "../rule.schema";
export const AB047: AgentReadinessRule = {
  rule_id: "AB-047", version: "1.0.0",
  name: "Rate limit headers present",
  category: "infrastructure", severity: "low", counted_in_score: true,
  check: { type: "header_check", target: "/mcp", sources: ["mcp"] },
  fix: { eligible: true, type: "deterministic", note: "Add X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset headers" },
};
