// Methodology: Marketing OS GEO rules (MIT) — docs/MARKETING/MarketingOS/01-RESEARCH-marketing-os.md
import type { AgentReadinessRule } from "../rule.schema";

export const AB187: AgentReadinessRule = {
  rule_id: "AB-187",
  version: "1.0.0",
  name: "Anti-citation disqualifiers",
  category: "seo_aeo",
  severity: "medium",
  counted_in_score: true,
  check: {
    type: "semantic_validation",
    sources: ["html"],
    semantic: "anti_citation",
  },
  fix: {
    eligible: true,
    type: "deterministic",
    note: "Remove overlays sitting over primary content (popups, cookie walls, interstitials), add named author and publish date to articles, and lower CTA density so content reads as a reference, not a funnel step",
  },
  display_question:
    "Is the content free of disqualifiers: interstitials, funnel-grade CTA density, missing author/date?",
};
