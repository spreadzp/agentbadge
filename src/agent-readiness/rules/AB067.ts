import type { AgentReadinessRule } from "../rule.schema";

export const AB067: AgentReadinessRule = {
  rule_id: "AB-067",
  version: "1.0.0",
  name: "Web Bot Auth directory (HTTP Message Signatures)",
  category: "bot_auth",
  severity: "medium",
  counted_in_score: true,
  check: {
    type: "http_fetch",
    target: "/.well-known/http-message-signatures-directory",
    sources: ["web_bot_auth"],
  },
  fix: {
    eligible: true,
    type: "assisted",
    note: "Publish /.well-known/http-message-signatures-directory with JWKS for HTTP Message Signatures",
  },
};
