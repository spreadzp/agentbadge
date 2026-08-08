import type { AgentReadinessRule } from "../rule.schema";
export const AB052: AgentReadinessRule = {
  rule_id: "AB-052", version: "1.0.0",
  name: "og:image reachable",
  category: "documentation", severity: "low", counted_in_score: true,
  check: { type: "http_probe", target: "/icons/og-image.png", sources: ["content_negotiation"] },
  fix: { eligible: true, type: "deterministic", note: "Ensure og:image URL returns 200" },
};
