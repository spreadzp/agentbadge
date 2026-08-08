import type { AgentReadinessRule } from "../rule.schema";
export const AB055: AgentReadinessRule = {
  rule_id: "AB-055", version: "1.0.0",
  name: "RSS feed linked from HTML",
  category: "documentation", severity: "low", counted_in_score: true,
  check: { type: "content_parse", target: "/", sources: ["rss_feed"] },
  fix: { eligible: true, type: "deterministic", note: "Add <link rel='alternate' type='application/rss+xml' href='/feed'> to HTML head" },
};
