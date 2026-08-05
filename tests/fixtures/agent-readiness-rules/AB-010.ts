import type { AgentReadinessRule } from "../../../src/agent-readiness/rule.schema";

export const AB010: AgentReadinessRule = {
  rule_id: "AB-010",
  version: "1.0.0",
  name: "Pricing machine-readable",
  category: "machine_readable",
  severity: "medium",
  counted_in_score: true,
  check: {
    type: "http_fetch",
    target: "/pricing.json",
  },
  fix: {
    eligible: true,
    type: "assisted",
    note: "Can draft a pricing.json skeleton from detected price text on the page, flagged low-confidence, never auto-applied",
  },
};
