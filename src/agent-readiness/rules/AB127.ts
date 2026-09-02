import type { AgentReadinessRule } from "../rule.schema";
export const AB127: AgentReadinessRule = {
  rule_id: "AB-127", version: "1.0.0",
  name: "Area served defined",
  category: "seo_aeo", severity: "medium", counted_in_score: true,
  check: {
    type: "content_parse",
    sources: ["operational_discovery"],
  },
  fix: {
    eligible: false, type: "none",
    note: "Add schema.org areaServed property to your LocalBusiness structured data",
  },
};
