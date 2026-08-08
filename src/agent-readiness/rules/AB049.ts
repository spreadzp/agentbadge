import type { AgentReadinessRule } from "../rule.schema";
export const AB049: AgentReadinessRule = {
  rule_id: "AB-049", version: "1.0.0",
  name: "RSS/Atom feed available",
  category: "documentation", severity: "low", counted_in_score: true,
  check: { type: "http_fetch", target: "/feed", sources: ["rss_feed"] },
  fix: { eligible: true, type: "deterministic", note: "Serve RSS 2.0 feed at /feed" },
};
