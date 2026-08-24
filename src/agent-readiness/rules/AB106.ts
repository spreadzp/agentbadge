import type { AgentReadinessRule } from "../rule.schema";
export const AB106: AgentReadinessRule = {
  rule_id: "AB-106", version: "1.0.0",
  name: "AEO short-answer summary block",
  category: "seo_aeo", severity: "low", counted_in_score: true,
  check: {
    type: "content_parse",
    sources: ["aeo_content"],
    target: "/blog",
    match_keys: ["hasShortAnswer"],
  },
  fix: {
    eligible: false, type: "none",
    note: "Add a short-answer summary block (2-3 sentences) at the top of article pages for AI answer engines",
  },
};
