import type { AgentReadinessRule } from "../rule.schema";

export const AB064: AgentReadinessRule = {
  rule_id: "AB-064",
  version: "1.0.0",
  name: "Auth.md agent registration instructions",
  category: "documentation",
  severity: "low",
  counted_in_score: true,
  check: {
    type: "http_fetch",
    target: "/auth.md",
    sources: ["auth_md"],
  },
  fix: {
    eligible: true,
    type: "deterministic",
    note: "Serve /auth.md with markdown instructions for agent authentication and registration",
  },
};
