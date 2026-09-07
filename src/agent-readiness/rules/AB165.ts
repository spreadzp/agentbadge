import type { AgentReadinessRule } from "../rule.schema";

export const AB165: AgentReadinessRule = {
  rule_id: "AB-165",
  version: "1.0.0",
  name: "Agent feeds (JSON Feed 1.1 / RSS 2.0)",
  category: "discovery",
  severity: "low",
  counted_in_score: true,
  check: {
    type: "semantic_validation",
    sources: ["agent_feeds"],
    semantic: "agent_feeds",
  },
  fix: {
    eligible: true,
    type: "deterministic",
    note: "Serve a JSON Feed 1.1 (version field starting with https://jsonfeed.org/) or RSS 2.0 (<rss> root with <channel>) at common paths like /agents.json, /jobs.rss, or /feed.json",
  },
  display_question: "Does the site provide structured feeds for agents, jobs, or tasks?",
};
