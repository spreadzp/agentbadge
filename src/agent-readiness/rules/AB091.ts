import type { AgentReadinessRule } from "../rule.schema";
export const AB091: AgentReadinessRule = {
  rule_id: "AB-091", version: "1.0.0",
  name: "Favicon PNG available",
  category: "discovery", severity: "low", counted_in_score: true,
  check: { type: "http_fetch", target: "/favicon.png", sources: ["favicon"] },
  fix: { eligible: true, type: "deterministic", note: "Add favicon.png for legacy agent and browser support" },
};
