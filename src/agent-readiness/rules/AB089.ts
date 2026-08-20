import type { AgentReadinessRule } from "../rule.schema";
export const AB089: AgentReadinessRule = {
  rule_id: "AB-089", version: "1.0.0",
  name: "og:image declared in meta",
  category: "discovery", severity: "low", counted_in_score: true,
  check: { type: "content_parse", target: "/", sources: ["homepage_meta"] },
  fix: { eligible: true, type: "deterministic", note: "Add <meta property='og:image' content='/icons/og-image.png'> to homepage <head>" },
};
