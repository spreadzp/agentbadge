import type { AgentReadinessRule } from "../rule.schema";

export const AB154: AgentReadinessRule = {
  rule_id: "AB-154",
  version: "1.0.0",
  name: "Retry semantics declared",
  category: "retry_semantics",
  severity: "medium",
  counted_in_score: true,
  check: {
    type: "semantic_validation",
    sources: ["openapi", "guide"],
    semantic: "retry_semantics_declared",
  },
  fix: {
    eligible: false,
    type: "assisted",
    note: "Declare Idempotency-Key support and Retry-After headers for 429/5xx responses",
  },
};
