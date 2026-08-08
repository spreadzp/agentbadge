import type { AgentReadinessRule } from "../rule.schema";

export const AB065: AgentReadinessRule = {
  rule_id: "AB-065",
  version: "1.0.0",
  name: "Agent Skills index",
  category: "skills",
  severity: "medium",
  counted_in_score: true,
  check: {
    type: "http_fetch",
    target: "/.well-known/agent-skills/index.json",
    sources: ["agent_skills"],
  },
  fix: {
    eligible: true,
    type: "assisted",
    note: "Publish /.well-known/agent-skills/index.json with $schema and skills array (name, type, description, url, sha256)",
  },
};
