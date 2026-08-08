import type { AgentReadinessRule } from "../rule.schema";
export const AB054: AgentReadinessRule = {
  rule_id: "AB-054", version: "1.0.0",
  name: "Canonical URL correct",
  category: "documentation", severity: "low", counted_in_score: true,
  check: { type: "content_parse", target: "/", sources: ["content_negotiation"] },
  fix: { eligible: true, type: "deterministic", note: "Add correct <link rel='canonical'> to HTML head" },
};
