import type { AgentReadinessRule } from "../rule.schema";
export const AB081: AgentReadinessRule = {
  rule_id: "AB-081", version: "1.0.0",
  name: "llms-full.txt linked from HTML",
  category: "discovery", severity: "medium", counted_in_score: true,
  check: { type: "content_parse", target: "/", sources: ["homepage_meta"] },
  fix: { eligible: true, type: "deterministic", note: "Add <link rel='alternate' type='text/plain' href='/llms-full.txt'> to homepage <head>" },
};
