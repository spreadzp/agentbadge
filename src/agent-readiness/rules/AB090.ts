import type { AgentReadinessRule } from "../rule.schema";
export const AB090: AgentReadinessRule = {
  rule_id: "AB-090", version: "1.0.0",
  name: "twitter:card set",
  category: "discovery", severity: "low", counted_in_score: true,
  check: { type: "content_parse", target: "/", sources: ["homepage_meta"] },
  fix: { eligible: true, type: "deterministic", note: "Add <meta name='twitter:card' content='summary_large_image'> to homepage <head>" },
};
