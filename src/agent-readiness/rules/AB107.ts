import type { AgentReadinessRule } from "../rule.schema";
export const AB107: AgentReadinessRule = {
  rule_id: "AB-107", version: "1.0.0",
  name: "Semantic definition lists in guide content",
  category: "seo_aeo", severity: "low", counted_in_score: true,
  check: {
    type: "content_parse",
    sources: ["semantic_html"],
    target: "/guides",
    match_keys: ["hasDefinitionList"],
  },
  fix: {
    eligible: false, type: "none",
    note: "Use <dl><dt><dd> definition lists for term/definition pairs in guide pages",
  },
};
