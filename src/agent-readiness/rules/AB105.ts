import type { AgentReadinessRule } from "../rule.schema";
export const AB105: AgentReadinessRule = {
  rule_id: "AB-105", version: "1.0.0",
  name: "Article author and date meta tags",
  category: "seo_aeo", severity: "medium", counted_in_score: true,
  check: {
    type: "content_parse",
    sources: ["og_meta"],
    target: "/blog",
    match_keys: ["articleAuthor", "articlePublishedTime", "articleModifiedTime"],
  },
  fix: {
    eligible: false, type: "none",
    note: "Add article:author, article:published_time, article:modified_time meta tags",
  },
};
