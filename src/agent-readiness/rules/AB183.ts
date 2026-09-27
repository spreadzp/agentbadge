// Methodology: Marketing OS GEO rules (MIT) — docs/MARKETING/MarketingOS/01-RESEARCH-marketing-os.md
import type { AgentReadinessRule } from "../rule.schema";

export const AB183: AgentReadinessRule = {
  rule_id: "AB-183",
  version: "1.0.0",
  name: "Answer-first extractability",
  category: "seo_aeo",
  severity: "low",
  counted_in_score: true,
  check: {
    type: "semantic_validation",
    sources: ["html"],
    semantic: "answer_first",
  },
  fix: {
    eligible: true,
    type: "deterministic",
    note: "Restructure key pages so each question-shaped heading is followed by a self-contained 80–200 word answer block that AI systems can quote without surrounding context",
  },
  display_question:
    "Are question-shaped headings followed by self-contained answer blocks AI systems can quote?",
};
