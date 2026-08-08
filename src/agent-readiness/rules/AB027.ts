import type { AgentReadinessRule } from "../rule.schema";

export const AB027: AgentReadinessRule = {
  rule_id: "AB-027",
  version: "1.0.0",
  name: "Skill file frontmatter valid",
  category: "skills",
  severity: "low",
  counted_in_score: true,
  check: {
    type: "schema_validation",
    target: "/skill.md",
    sources: ["skill"],
  },
  fix: {
    eligible: true,
    type: "assisted",
    note: "Add YAML frontmatter with name, description, and capabilities fields",
  },
};
