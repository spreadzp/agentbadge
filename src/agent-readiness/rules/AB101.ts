import type { AgentReadinessRule } from "../rule.schema";
export const AB101: AgentReadinessRule = {
  rule_id: "AB-101", version: "1.0.0",
  name: "Breadcrumb navigation on service pages",
  category: "seo_aeo", severity: "low", counted_in_score: true,
  check: {
    type: "content_parse",
    sources: ["semantic_html"],
    target: "/services",
    match_keys: ["hasBreadcrumbs"],
  },
  fix: {
    eligible: false, type: "none",
    note: "Add breadcrumb navigation (BreadcrumbList JSON-LD or .breadcrumb HTML) to service pages for SEO and UX",
  },
};
