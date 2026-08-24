import type { AgentReadinessRule } from "../rule.schema";
export const AB104: AgentReadinessRule = {
  rule_id: "AB-104", version: "1.0.0",
  name: "Blog article OpenGraph type",
  category: "seo_aeo", severity: "medium", counted_in_score: true,
  check: {
    type: "content_parse",
    sources: ["og_meta"],
    target: "/blog",
    match_keys: ["ogType"],
  },
  fix: {
    eligible: false, type: "none",
    note: "Set og:type=article on blog post pages via meta tag in HTML head",
  },
};
