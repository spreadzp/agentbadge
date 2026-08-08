import type { AgentReadinessRule } from "../rule.schema";

export const AB066: AgentReadinessRule = {
  rule_id: "AB-066",
  version: "1.0.0",
  name: "Content Signals in robots.txt",
  category: "discovery",
  severity: "low",
  counted_in_score: true,
  check: {
    type: "content_parse",
    target: "/robots.txt",
    sources: ["content_signals"],
  },
  fix: {
    eligible: true,
    type: "deterministic",
    note: "Add Content-Signal directive to robots.txt (e.g. Content-Signal: ai-train=no, search=yes, ai-input=no)",
  },
};
