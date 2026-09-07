import type { AgentReadinessRule } from "../rule.schema";

export const AB161: AgentReadinessRule = {
  rule_id: "AB-161",
  version: "1.0.0",
  name: "AI-Agent Discovery meta tags",
  category: "discovery",
  severity: "high",
  counted_in_score: true,
  check: {
    type: "semantic_validation",
    sources: ["homepage_meta"],
    semantic: "ai_agent_discovery_meta",
  },
  fix: {
    eligible: true,
    type: "deterministic",
    note: 'Add <meta name="ai-agent-discovery" content="{llms.txt URL}"> and <meta name="ai-agent-onboarding" content="{skill.md URL}"> to your HTML head',
  },
  display_question: "Where should an AI agent start on this site?",
};
