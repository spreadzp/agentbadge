import type { AgentReadinessRule } from "../rule.schema";

export const AB068: AgentReadinessRule = {
  rule_id: "AB-068",
  version: "1.0.0",
  name: "DNS-AID records for agent discovery",
  category: "discovery",
  severity: "low",
  counted_in_score: true,
  check: {
    type: "http_probe",
    target: "_agent.{domain}",
    sources: ["dns_aid"],
  },
  fix: {
    eligible: false,
    type: "none",
    note: "DNS-AID records require manual DNS configuration — publish TXT record at _agent.{domain}",
  },
};
