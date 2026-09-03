import type { AgentReadinessRule } from "../rule.schema";

export const AB157: AgentReadinessRule = {
  rule_id: "AB-157",
  version: "1.0.0",
  name: "Agent policy machine-readable",
  category: "agent_policy",
  severity: "medium",
  counted_in_score: true,
  check: {
    type: "semantic_validation",
    sources: ["guide", "llms", "ai_txt"],
    semantic: "agent_policy_machine_readable",
  },
  fix: {
    eligible: false,
    type: "assisted",
    note: "Add explicit agent permissions (Allow/Disallow) in agents.txt, guide policy field, or llms.txt policy section",
  },
  display_question: "Am I allowed to use this API as an AI agent?",
};
