import type { AgentReadinessRule } from "../rule.schema";
export const AB048: AgentReadinessRule = {
  rule_id: "AB-048", version: "1.0.0",
  name: "agents.txt found",
  category: "agents_txt", severity: "medium", counted_in_score: true,
  check: { type: "http_fetch", target: "/agents.txt", sources: ["agents_txt"] },
  fix: { eligible: true, type: "deterministic", note: "Create /agents.txt with agent access policies" },
};
