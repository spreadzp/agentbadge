// Methodology: Marketing OS GEO rules (MIT) — docs/MARKETING/MarketingOS/01-RESEARCH-marketing-os.md
import type { AgentReadinessRule } from "../rule.schema";

export const AB186: AgentReadinessRule = {
  rule_id: "AB-186",
  version: "1.0.0",
  name: "Server-rendered primary content in initial HTML",
  category: "seo_aeo",
  severity: "low",
  counted_in_score: true,
  check: {
    type: "semantic_validation",
    sources: ["html"],
    semantic: "server_rendered",
  },
  fix: {
    eligible: true,
    type: "deterministic",
    note: "Server-render or pre-render primary content — AI crawlers (GPTBot, PerplexityBot, ClaudeBot) largely do not execute JS; a CSR-only page is invisible to them",
  },
  display_question:
    "Is the primary content present in the initial HTML without executing JavaScript?",
};
