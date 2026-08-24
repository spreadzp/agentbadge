import type { AgentReadinessRule } from "../rule.schema";
export const AB112: AgentReadinessRule = {
  rule_id: "AB-112", version: "1.0.0",
  name: "OAuth Authorization Server metadata (RFC 9728)",
  category: "identity", severity: "medium", counted_in_score: true,
  check: {
    type: "http_fetch",
    target: "/.well-known/oauth-authorization-server",
  },
  fix: {
    eligible: false, type: "none",
    note: "Publish OAuth Authorization Server Metadata at /.well-known/oauth-authorization-server per RFC 9728",
  },
};
