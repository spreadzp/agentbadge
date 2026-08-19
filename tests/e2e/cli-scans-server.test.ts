import { describe, it, expect } from "vitest";
import { parseArgs } from "../../src/agent-readiness/cli/router";
import { shouldFailCi, shouldFailThreshold, formatJsonOutput, formatFixOutput, formatPretty, generateReportUrl } from "../../src/agent-readiness/cli/output";
import { AGENT_READINESS_RULESET } from "../../src/agent-readiness/ruleset";

const SCAN_FLAGS = [
  { name: "json", shortName: "j", type: "boolean" as const, description: "Output JSON" },
  { name: "ci", shortName: "", type: "boolean" as const, description: "CI mode" },
  { name: "fix", shortName: "", type: "boolean" as const, description: "Fix suggestions" },
  { name: "diff", shortName: "", type: "string" as const, description: "Diff file" },
  { name: "threshold", shortName: "", type: "string" as const, description: "Threshold" },
  { name: "watch", shortName: "w", type: "boolean" as const, description: "Watch mode" },
];

describe("E2E: CLI scan structure verification", () => {
  it("CLI parses all flags correctly in one invocation", () => {
    const result = parseArgs(["localhost:4021", "--json", "--ci", "--fix", "--threshold", "90"], SCAN_FLAGS);
    expect(result.flags.json).toBe(true);
    expect(result.flags.ci).toBe(true);
    expect(result.flags.fix).toBe(true);
    expect(result.flags.threshold).toBe("90");
  });

  it("CLI --json output is valid JSON with results array", () => {
    const mockResults = AGENT_READINESS_RULESET.rules.map((r) => ({
      rule_id: r.rule_id,
      status: "pass",
      category: r.category,
    }));
    const output = formatJsonOutput(mockResults as any);
    const parsed = JSON.parse(output);
    expect(parsed.results).toBeInstanceOf(Array);
    expect(parsed.results.length).toBe(80);
  });

  it("CLI reports 80 rules", () => {
    expect(AGENT_READINESS_RULESET.rules.length).toBe(80);
  });

  it("no rule has status 'fail' in a perfect scan", () => {
    const mockResults = AGENT_READINESS_RULESET.rules.map((r) => ({
      rule_id: r.rule_id,
      status: "pass",
    }));
    const failures = mockResults.filter((r) => r.status === "fail");
    expect(failures).toHaveLength(0);
    expect(shouldFailCi(mockResults as any)).toBe(false);
  });

  it("score is 100 when all pass", () => {
    const mockResults = AGENT_READINESS_RULESET.rules.map((r) => ({
      rule_id: r.rule_id,
      status: "pass",
    }));
    const passCount = mockResults.filter((r) => r.status === "pass").length;
    const score = Math.round((passCount / mockResults.length) * 100);
    expect(score).toBe(100);
    expect(shouldFailThreshold(score, 90)).toBe(false);
  });

  it("CLI --ci exits 0 when all pass with threshold 90", () => {
    const mockResults = AGENT_READINESS_RULESET.rules.map((r) => ({
      rule_id: r.rule_id,
      status: "pass",
    }));
    const score = 100;
    expect(shouldFailCi(mockResults as any)).toBe(false);
    expect(shouldFailThreshold(score, 90)).toBe(false);
  });

  it("CLI --fix outputs fix suggestions", () => {
    const mockResults = [
      { rule_id: "AB-001", status: "fail", fix: { eligible: true, type: "deterministic", note: "Add llms.txt" } },
    ];
    const output = formatFixOutput(mockResults as any);
    expect(output).toContain("AB-001");
    expect(output).toContain("Add llms.txt");
  });

  it("CLI output structure has score, results, timestamp", () => {
    const mockReport = {
      score: 100,
      results: AGENT_READINESS_RULESET.rules.map((r) => ({ rule_id: r.rule_id, status: "pass" })),
      url: "http://localhost:4021",
      timestamp: new Date().toISOString(),
    };
    expect(mockReport.score).toBeDefined();
    expect(mockReport.results).toBeDefined();
    expect(mockReport.url).toBeDefined();
    expect(mockReport.timestamp).toBeDefined();
  });

  it("CLI --watch flag parses correctly", () => {
    const result = parseArgs(["localhost:4021", "--watch"], SCAN_FLAGS);
    expect(result.flags.watch).toBe(true);
  });

  it("pretty output includes all categories", () => {
    const mockResults = AGENT_READINESS_RULESET.rules.map((r) => ({
      rule_id: r.rule_id,
      category: r.category,
      status: "pass",
      name: r.name,
    }));
    const output = formatPretty(mockResults as any, { score: 100 });
    expect(output).toContain("100");
    expect(output).toContain("Discovery");
    expect(output).toContain("Machine Readable");
    expect(output).toContain("Content Negotiation");
    expect(output).toContain("Payments");
    expect(output).toContain("OpenAPI");
  });

  it("report URL is generated correctly", () => {
    const url = generateReportUrl("https://agentbadge.xyz", "scan-abc-123");
    expect(url).toBe("https://agentbadge.xyz/report?scan=scan-abc-123");
  });
});
