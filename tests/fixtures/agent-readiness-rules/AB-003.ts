import type { AgentReadinessRule } from "../../../src/agent-readiness/rule.schema";

export const AB003: AgentReadinessRule = {
  rule_id: "AB-003",
  version: "1.1.0",
  name: "agent-guide discoverable (JSON, Markdown, or HTML)",
  category: "discovery",
  severity: "high",
  counted_in_score: true,
  check: {
    type: "http_fetch",
    target: "/.well-known/agent-guide.json",
  },
  fix: {
    eligible: true,
    type: "deterministic",
    note: "Scaffold an agent-guide endpoint at /.well-known/agent-guide.json (JSON) or /agent-guide (Markdown/HTML) with required fields present but unfilled (status: draft); does not invent capability data",
  },
};
