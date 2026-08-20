import type { AgentReadinessRule } from "../rule.schema";
export const AB084: AgentReadinessRule = {
  rule_id: "AB-084", version: "1.0.0",
  name: "Organization JSON-LD with sameAs",
  category: "discovery", severity: "medium", counted_in_score: true,
  check: { type: "content_parse", target: "/", sources: ["homepage_meta"] },
  fix: { eligible: true, type: "assisted", note: "Add Organization JSON-LD with sameAs links to social profiles (GitHub, Twitter, LinkedIn)" },
};
