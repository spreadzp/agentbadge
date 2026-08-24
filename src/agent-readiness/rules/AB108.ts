import type { AgentReadinessRule } from "../rule.schema";
export const AB108: AgentReadinessRule = {
  rule_id: "AB-108", version: "1.0.0",
  name: "OG image alt text brand consistency",
  category: "seo_aeo", severity: "low", counted_in_score: true,
  check: {
    type: "content_parse",
    sources: ["og_meta"],
    match_keys: ["ogImageAlt"],
  },
  fix: {
    eligible: false, type: "none",
    note: "Ensure og:image:alt text includes your brand name and matches page context",
  },
};
