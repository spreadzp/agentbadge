import type { AgentReadinessRule } from "../rule.schema";
export const AB100: AgentReadinessRule = {
  rule_id: "AB-100", version: "1.0.0",
  name: "Service page content depth",
  category: "seo_aeo", severity: "low", counted_in_score: true,
  check: {
    type: "content_parse",
    sources: ["content_depth"],
    target: "/services",
    match_keys: ["wordCount"],
  },
  fix: {
    eligible: false, type: "none",
    note: "Ensure service pages have at least 300 words of meaningful content for SEO and AI comprehension",
  },
};
