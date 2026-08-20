import type { AgentReadinessRule } from "../rule.schema";
export const AB080: AgentReadinessRule = {
  rule_id: "AB-080", version: "1.0.0",
  name: "llms-full.txt exists",
  category: "discovery", severity: "medium", counted_in_score: true,
  check: { type: "http_fetch", target: "/llms-full.txt", sources: ["llms_full"] },
  fix: { eligible: true, type: "deterministic", note: "Create /llms-full.txt with comprehensive documentation for agents" },
};
