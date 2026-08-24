import type { AgentReadinessRule } from "../rule.schema";
export const AB111: AgentReadinessRule = {
  rule_id: "AB-111", version: "1.0.0",
  name: "Crawl-delay directive in robots.txt",
  category: "discovery", severity: "low", counted_in_score: true,
  check: {
    type: "content_parse",
    sources: ["robots"],
    match_keys: ["crawlDelay"],
  },
  fix: {
    eligible: true, type: "deterministic",
    note: "Add 'Crawl-delay: 1' to robots.txt to prevent aggressive crawling",
  },
};
