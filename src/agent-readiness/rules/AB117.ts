import type { AgentReadinessRule } from "../rule.schema";
export const AB117: AgentReadinessRule = {
  rule_id: "AB-117", version: "1.0.0",
  name: "Image alt text coverage",
  category: "accessibility", severity: "medium", counted_in_score: true,
  check: {
    type: "content_parse",
    sources: ["accessibility"],
    match_keys: ["imagesWithoutAlt"],
  },
  fix: {
    eligible: false, type: "none",
    note: "Add alt text to all content images. Decorative images should use alt=\"\"",
  },
};
