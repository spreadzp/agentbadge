import type { AgentReadinessRule } from "../../../src/agent-readiness/rule.schema";

export const AB013: AgentReadinessRule = {
  rule_id: "AB-013",
  version: "1.0.0",
  name: "Owner verification status",
  category: "verification",
  severity: "medium",
  counted_in_score: true,
  check: {
    type: "exact_match",
    sources: ["dns_txt_record", "meta_tag_challenge"],
    match_keys: ["verification_token"],
  },
  fix: {
    eligible: false,
    type: "none",
    note: "Inherently requires the owner to act",
  },
};
