import type { AgentReadinessRule } from "../rule.schema";
export const AB045: AgentReadinessRule = {
  rule_id: "AB-045", version: "1.0.0",
  name: "Cache headers present",
  category: "infrastructure", severity: "medium", counted_in_score: true,
  check: { type: "header_check", target: "/", sources: ["content_negotiation"] },
  fix: { eligible: true, type: "deterministic", note: "Add Cache-Control header to responses" },
};
