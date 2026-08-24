import type { AgentReadinessRule } from "../rule.schema";
export const AB113: AgentReadinessRule = {
  rule_id: "AB-113", version: "1.0.0",
  name: "LLM policy file",
  category: "discovery", severity: "low", counted_in_score: true,
  check: {
    type: "http_fetch",
    target: "/.well-known/llm-policy.json",
  },
  fix: {
    eligible: false, type: "none",
    note: "Publish an LLM usage policy at /.well-known/llm-policy.json",
  },
};
