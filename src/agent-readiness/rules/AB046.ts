import type { AgentReadinessRule } from "../rule.schema";
export const AB046: AgentReadinessRule = {
  rule_id: "AB-046", version: "1.0.0",
  name: "Structured JSON 404 errors",
  category: "infrastructure", severity: "medium", counted_in_score: true,
  check: { type: "http_probe", target: "/nonexistent", sources: ["content_negotiation"] },
  fix: { eligible: true, type: "deterministic", note: "Return JSON error body for 404 responses" },
};
