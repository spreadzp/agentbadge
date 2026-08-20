import type { AgentReadinessRule } from "../rule.schema";
export const AB083: AgentReadinessRule = {
  rule_id: "AB-083", version: "1.0.0",
  name: "JSON-LD structured data present",
  category: "discovery", severity: "medium", counted_in_score: true,
  check: { type: "content_parse", target: "/", sources: ["homepage_meta"] },
  fix: { eligible: true, type: "deterministic", note: "Add JSON-LD structured data blocks to homepage <head>" },
};
