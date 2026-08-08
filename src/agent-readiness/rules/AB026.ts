import type { AgentReadinessRule } from "../rule.schema";

export const AB026: AgentReadinessRule = {
  rule_id: "AB-026",
  version: "1.0.0",
  name: "Skill file found",
  category: "skills",
  severity: "medium",
  counted_in_score: true,
  check: {
    type: "http_fetch",
    target: "/skill.md",
    sources: ["skill"],
  },
  fix: {
    eligible: true,
    type: "deterministic",
    note: "Create skill.md with agent capability description",
  },
};
