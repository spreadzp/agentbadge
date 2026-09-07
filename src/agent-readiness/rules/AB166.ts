import type { AgentReadinessRule } from "../rule.schema";

export const AB166: AgentReadinessRule = {
  rule_id: "AB-166",
  version: "1.0.0",
  name: "next_call pattern in API responses",
  category: "actionability",
  severity: "low",
  counted_in_score: true,
  check: {
    type: "semantic_validation",
    sources: ["openapi_standard"],
    semantic: "next_call_pattern",
  },
  fix: {
    eligible: true,
    type: "deterministic",
    note: "Include a next_call field in API responses with method (string), path (string), and why (string) to guide agents to the next request",
  },
  display_question: "Do API responses include a next_call field guiding agents to the next request?",
};
