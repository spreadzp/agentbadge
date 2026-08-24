import type { AgentReadinessRule } from "../rule.schema";
export const AB114: AgentReadinessRule = {
  rule_id: "AB-114", version: "1.0.0",
  name: "AI sitemap content type coverage",
  category: "discovery", severity: "medium", counted_in_score: true,
  check: {
    type: "cross_evidence",
    sources: ["ai_sitemap", "sitemap"],
    conflict_when: "ai_sitemap_url_count < sitemap_url_count * 0.5",
  },
  fix: {
    eligible: false, type: "none",
    note: "Ensure ai-sitemap.xml covers at least 50% of the URLs in sitemap.xml, including blog, guides, and service pages",
  },
};
