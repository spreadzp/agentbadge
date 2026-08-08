import type { AgentReadinessRule } from "../rule.schema";

export const AB062: AgentReadinessRule = {
  rule_id: "AB-062",
  version: "1.0.0",
  name: "API Catalog endpoint (RFC 9727)",
  category: "discovery",
  severity: "medium",
  counted_in_score: true,
  check: {
    type: "http_fetch",
    target: "/.well-known/api-catalog",
    sources: ["api_catalog"],
  },
  fix: {
    eligible: true,
    type: "assisted",
    note: "Publish /.well-known/api-catalog returning application/linkset+json with API endpoint descriptions",
  },
};
