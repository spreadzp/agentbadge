import type { AgentReadinessRule } from "../../../src/agent-readiness/rule.schema";

export const AB011: AgentReadinessRule = {
  rule_id: "AB-011",
  version: "1.0.0",
  name: "Rate limits declared machine-readably",
  category: "machine_readable",
  severity: "low",
  counted_in_score: true,
  check: {
    type: "http_fetch",
    match_keys: ["X-RateLimit-Limit", "X-RateLimit-Remaining", "RateLimit-Limit", "RateLimit-Remaining"],
  },
  fix: {
    eligible: true,
    type: "assisted",
    note: "Suggest documenting observed header values in the guide",
  },
};
