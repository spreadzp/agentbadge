import type { AgentReadinessRule } from "../rule.schema";
export const AB073: AgentReadinessRule = {
  rule_id: "AB-073", version: "1.0.0",
  name: "HTTPS redirect enforced",
  category: "infrastructure", severity: "high", counted_in_score: true,
  check: { type: "http_probe", target: "http://{domain}/", sources: ["infrastructure"] },
  fix: { eligible: true, type: "deterministic", note: "Configure HTTP-to-HTTPS redirect at server or CDN level" },
};
