// Methodology: Marketing OS GEO rules (MIT) — docs/MARKETING/MarketingOS/01-RESEARCH-marketing-os.md
import type { AgentReadinessRule } from "../rule.schema";

export const AB185: AgentReadinessRule = {
  rule_id: "AB-185",
  version: "1.0.0",
  name: "Entity clarity and canonical naming",
  category: "seo_aeo",
  severity: "low",
  counted_in_score: true,
  check: {
    type: "semantic_validation",
    sources: ["html"],
    semantic: "entity_clarity",
  },
  fix: {
    eligible: true,
    type: "deterministic",
    note: "Add a one-line canonical self-description ('X is a <category> for <audience>'), keep the brand name consistent across title, og:site_name and JSON-LD, and link an About page — models must unambiguously identify the entity to cite it",
  },
  display_question:
    "Can a model unambiguously identify the entity: canonical description, consistent naming, About/schema signals?",
};
