import type { AgentReadinessRule } from "../rule.schema";
export const AB110: AgentReadinessRule = {
  rule_id: "AB-110", version: "1.0.0",
  name: "Blog articles in AI sitemap",
  category: "discovery", severity: "medium", counted_in_score: true,
  check: {
    type: "content_parse",
    sources: ["ai_sitemap"],
    match_keys: ["blogUrls"],
  },
  fix: {
    eligible: false, type: "none",
    note: "Include blog article URLs in /.well-known/ai-sitemap.xml for AI agent discovery",
  },
};
