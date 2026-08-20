import type { AgentReadinessRule } from "../rule.schema";
export const AB079: AgentReadinessRule = {
  rule_id: "AB-079", version: "1.0.0",
  name: "llms.txt markdown structure valid",
  category: "discovery", severity: "medium", counted_in_score: true,
  check: { type: "content_parse", target: "/llms.txt", sources: ["llms"] },
  fix: { eligible: true, type: "deterministic", note: "Format llms.txt with markdown headers (#) and optional link lines per llms.txt spec" },
};
