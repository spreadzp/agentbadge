import type { AgentReadinessRule } from "../rule.schema";

export const AB164: AgentReadinessRule = {
  rule_id: "AB-164",
  version: "1.0.0",
  name: "Error catalog endpoint",
  category: "machine_readable",
  severity: "low",
  counted_in_score: true,
  check: {
    type: "semantic_validation",
    sources: ["error_catalog"],
    semantic: "error_catalog",
  },
  fix: {
    eligible: true,
    type: "deterministic",
    note: "Serve a JSON error catalog at /api/meta/errors (or /errors.json, /api/errors) with an array of error codes and descriptions",
  },
  display_question: "Does the site provide a machine-readable error catalog endpoint?",
};
