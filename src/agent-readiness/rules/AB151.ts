import type { AgentReadinessRule } from "../rule.schema";

export const AB151: AgentReadinessRule = {
  rule_id: "AB-151",
  version: "1.0.0",
  name: "Rate limits machine-readable",
  category: "rate_limits",
  severity: "high",
  counted_in_score: true,
  check: {
    type: "semantic_validation",
    sources: ["guide", "openapi", "llms"],
    semantic: "rate_limits_machine_readable",
  },
  fix: {
    eligible: false,
    type: "assisted",
    note: "Declare rate limits in machine-readable format and document over-limit behavior (429 + Retry-After)",
  },
  display_question: "How many calls can I make per minute?",
};
