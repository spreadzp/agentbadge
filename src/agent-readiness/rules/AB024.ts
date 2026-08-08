import type { AgentReadinessRule } from "../rule.schema";

export const AB024: AgentReadinessRule = {
  rule_id: "AB-024",
  version: "1.0.0",
  name: "llms-full.txt found",
  category: "documentation",
  severity: "medium",
  counted_in_score: true,
  check: {
    type: "http_fetch",
    target: "/llms-full.txt",
    sources: ["llms_full"],
  },
  fix: {
    eligible: true,
    type: "deterministic",
    note: "Generate llms-full.txt with complete LLM context",
  },
};
