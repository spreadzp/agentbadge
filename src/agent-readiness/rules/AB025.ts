import type { AgentReadinessRule } from "../rule.schema";

export const AB025: AgentReadinessRule = {
  rule_id: "AB-025",
  version: "1.0.0",
  name: "llms-full.txt linked from HTML",
  category: "documentation",
  severity: "low",
  counted_in_score: true,
  check: {
    type: "content_parse",
    target: "/",
    sources: ["llms_full"],
  },
  fix: {
    eligible: true,
    type: "deterministic",
    note: "Add <link rel='alternate' type='text/plain' href='/llms-full.txt'> to HTML head",
  },
};
