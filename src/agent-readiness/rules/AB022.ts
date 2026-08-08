import type { AgentReadinessRule } from "../rule.schema";

export const AB022: AgentReadinessRule = {
  rule_id: "AB-022",
  version: "1.0.0",
  name: "MCP SSE transport supported",
  category: "machine_readable",
  severity: "medium",
  counted_in_score: true,
  check: {
    type: "http_probe",
    target: "/mcp",
    sources: ["mcp"],
  },
  fix: {
    eligible: false,
    type: "none",
    note: "Add SSE transport support to MCP endpoint",
  },
};
