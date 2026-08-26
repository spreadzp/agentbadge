import type { AgentReadinessRule } from "../rule.schema";
export const AB126: AgentReadinessRule = {
  rule_id: "AB-126", version: "1.0.0",
  name: "Opening hours machine-readable",
  category: "seo_aeo", severity: "medium", counted_in_score: true,
  check: {
    type: "content_parse",
    sources: ["operational_discovery"],
  },
  fix: {
    eligible: false, type: "none",
    note: "Add schema.org openingHours property to your LocalBusiness structured data",
  },
};
