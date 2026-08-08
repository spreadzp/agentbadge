import { describe, it, expect } from "vitest";
import { formatPretty, generateReportUrl } from "../src/agent-readiness/cli/output";

describe("Pretty output", () => {
  it("groups results by category", () => {
    const results = [
      { rule_id: "AB-001", category: "machine_readable", status: "pass", name: "MCP found" },
      { rule_id: "AB-015", category: "content_negotiation", status: "fail", name: "Agent UA" },
    ];
    const output = formatPretty(results as any);
    expect(output).toContain("Machine Readable");
    expect(output).toContain("Content Negotiation");
    expect(output).toContain("PASS");
    expect(output).toContain("FAIL");
  });

  it("shows score at top", () => {
    const results = [{ rule_id: "AB-001", category: "machine_readable", status: "pass", name: "MCP found" }];
    const output = formatPretty(results as any, { score: 85 });
    expect(output).toContain("85");
  });

  it("generates web report URL", () => {
    const url = generateReportUrl("https://agentbadge.xyz", "scan-123");
    expect(url).toContain("agentbadge.xyz");
    expect(url).toContain("scan-123");
  });
});
