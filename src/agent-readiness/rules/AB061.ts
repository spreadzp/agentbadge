import type { AgentReadinessRule } from "../rule.schema";

export const AB061: AgentReadinessRule = {
  rule_id: "AB-061",
  version: "1.0.0",
  name: "Link headers on homepage (RFC 8288)",
  category: "discovery",
  severity: "medium",
  counted_in_score: true,
  check: {
    type: "header_check",
    target: "/",
    sources: ["link_headers"],
  },
  fix: {
    eligible: true,
    type: "assisted",
    note: "Add Link headers with rel=api-catalog, service-desc, oauth-server, sitemap to homepage response",
  },
};
