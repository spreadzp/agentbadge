import type { AgentReadinessRule } from "../rule.schema";
export const AB125: AgentReadinessRule = {
  rule_id: "AB-125", version: "1.0.0",
  name: "LocalBusiness schema.org present",
  category: "seo_aeo", severity: "high", counted_in_score: true,
  check: {
    type: "content_parse",
    sources: ["operational_discovery"],
  },
  fix: {
    eligible: false, type: "none",
    note: "Add schema.org/LocalBusiness JSON-LD structured data to your homepage",
  },
};
