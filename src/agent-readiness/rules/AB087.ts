import type { AgentReadinessRule } from "../rule.schema";
export const AB087: AgentReadinessRule = {
  rule_id: "AB-087", version: "1.0.0",
  name: "Google-Extended not blocked in robots.txt",
  category: "discovery", severity: "medium", counted_in_score: true,
  check: { type: "content_parse", target: "/robots.txt", sources: ["robots"] },
  fix: { eligible: true, type: "deterministic", note: "Allow Google-Extended in robots.txt to enable Google training data inclusion" },
};
