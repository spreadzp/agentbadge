import type { AgentReadinessRule } from "../rule.schema";

export const AB063: AgentReadinessRule = {
  rule_id: "AB-063",
  version: "1.0.0",
  name: "OAuth Protected Resource metadata (RFC 9728)",
  category: "bot_auth",
  severity: "medium",
  counted_in_score: true,
  check: {
    type: "http_fetch",
    target: "/.well-known/oauth-protected-resource",
    sources: ["oauth_protected_resource"],
  },
  fix: {
    eligible: true,
    type: "assisted",
    note: "Publish /.well-known/oauth-protected-resource with resource, authorization_servers, scopes_supported, bearer_methods_supported",
  },
};
