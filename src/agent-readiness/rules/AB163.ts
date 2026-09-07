import type { AgentReadinessRule } from "../rule.schema";

export const AB163: AgentReadinessRule = {
  rule_id: "AB-163",
  version: "1.0.0",
  name: "Skill.json (JSON-LD) availability",
  category: "machine_readable",
  severity: "low",
  counted_in_score: true,
  check: {
    type: "semantic_validation",
    sources: ["skill_json"],
    semantic: "skill_json_ld",
  },
  fix: {
    eligible: true,
    type: "deterministic",
    note: "Serve /skill.json as JSON-LD with @context, @type, name, and url or endpoints fields to provide a machine-readable agent onboarding contract",
  },
  display_question: "Does the site provide a skill.json JSON-LD document for agent onboarding?",
};
