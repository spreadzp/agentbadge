import type { AgentReadinessRule } from "../rule.schema";

export const AB162: AgentReadinessRule = {
  rule_id: "AB-162",
  version: "1.0.0",
  name: "Heartbeat.md availability",
  category: "actionability",
  severity: "low",
  counted_in_score: true,
  check: {
    type: "semantic_validation",
    sources: ["heartbeat"],
    semantic: "heartbeat_md",
  },
  fix: {
    eligible: true,
    type: "deterministic",
    note: "Serve /heartbeat.md with Markdown content and YAML frontmatter (---) to provide a periodic check-in routine for AI agents",
  },
  display_question: "Does the site provide a heartbeat.md for AI agent periodic check-ins?",
};
