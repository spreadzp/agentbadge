// Methodology: Marketing OS GEO rules (MIT) — docs/MARKETING/MarketingOS/01-RESEARCH-marketing-os.md
import type { AgentReadinessRule } from "../rule.schema";

export const AB184: AgentReadinessRule = {
  rule_id: "AB-184",
  version: "1.0.0",
  name: "Evidence density for citability",
  category: "seo_aeo",
  severity: "low",
  counted_in_score: true,
  check: {
    type: "semantic_validation",
    sources: ["html"],
    semantic: "evidence_density",
  },
  fix: {
    eligible: true,
    type: "deterministic",
    note: "Add citable evidence: named numbers with sources, dates near claims, fact tables or lists, and attributed quotations — pages with verifiable facts get cited far more than marketing prose",
  },
  display_question:
    "Does the page contain citable evidence (sourced numbers, dates, tables, quotations)?",
};
