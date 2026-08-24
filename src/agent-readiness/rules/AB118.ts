import type { AgentReadinessRule } from "../rule.schema";
export const AB118: AgentReadinessRule = {
  rule_id: "AB-118", version: "1.0.0",
  name: "Lazy loading on below-fold images",
  category: "accessibility", severity: "low", counted_in_score: true,
  check: {
    type: "content_parse",
    sources: ["accessibility"],
    match_keys: ["imagesWithLazyLoading"],
  },
  fix: {
    eligible: true, type: "deterministic",
    note: "Add loading=\"lazy\" to below-fold images to improve page load performance",
  },
};
