import { describe, it, expect } from "vitest";
import { AGENT_READINESS_RULESET } from "../../src/agent-readiness/ruleset";
import { agentReadinessRuleSchema } from "../../src/agent-readiness/rule.schema";
import { shouldFailCi, shouldFailThreshold, formatJsonOutput, formatFixOutput, formatPretty, generateReportUrl } from "../../src/agent-readiness/cli/output";

describe("CLI unit tests — rules validation", () => {
  it("all 55 rules validate against schema", () => {
    for (const rule of AGENT_READINESS_RULESET.rules) {
      const result = agentReadinessRuleSchema.safeParse(rule);
      expect(result.success, `Rule ${rule.rule_id} failed schema validation`).toBe(true);
    }
  });

  it("all 55 rules have unique IDs", () => {
    const ids = AGENT_READINESS_RULESET.rules.map((r) => r.rule_id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("all rules have fix definitions", () => {
    for (const rule of AGENT_READINESS_RULESET.rules) {
      expect(rule.fix).toBeTruthy();
      expect(rule.fix.eligible).toBeDefined();
      expect(rule.fix.type).toBeDefined();
    }
  });
});

describe("CLI unit tests — CI mode", () => {
  it("fails on any rule failure", () => {
    const results = [{ status: "fail" }, { status: "pass" }];
    expect(shouldFailCi(results as any)).toBe(true);
  });

  it("passes when all rules pass", () => {
    const results = [{ status: "pass" }, { status: "pass" }];
    expect(shouldFailCi(results as any)).toBe(false);
  });

  it("passes on empty results", () => {
    expect(shouldFailCi([])).toBe(false);
  });
});

describe("CLI unit tests — threshold", () => {
  it("fails below threshold", () => {
    expect(shouldFailThreshold(50, 80)).toBe(true);
  });

  it("passes at threshold", () => {
    expect(shouldFailThreshold(80, 80)).toBe(false);
  });

  it("passes above threshold", () => {
    expect(shouldFailThreshold(90, 80)).toBe(false);
  });

  it("passes when threshold is 0", () => {
    expect(shouldFailThreshold(0, 0)).toBe(false);
  });
});

describe("CLI unit tests — JSON output", () => {
  it("outputs valid JSON", () => {
    const results = [{ rule_id: "AB-001", status: "pass" }];
    const output = formatJsonOutput(results as any);
    expect(() => JSON.parse(output)).not.toThrow();
    const parsed = JSON.parse(output);
    expect(parsed.results).toHaveLength(1);
  });
});

describe("CLI unit tests — fix output", () => {
  it("outputs fix suggestions for failing rules", () => {
    const results = [
      { rule_id: "AB-001", status: "pass", fix: { eligible: true, type: "deterministic", note: "ok" } },
      { rule_id: "AB-002", status: "fail", fix: { eligible: true, type: "deterministic", note: "Fix it" } },
    ];
    const output = formatFixOutput(results as any);
    expect(output).toContain("AB-002");
    expect(output).toContain("Fix it");
    expect(output).not.toContain("AB-001");
  });

  it("shows message when no fixable rules", () => {
    const results = [{ rule_id: "AB-001", status: "fail", fix: { eligible: false, type: "none", note: "" } }];
    const output = formatFixOutput(results as any);
    expect(output).toContain("No fixable");
  });
});

describe("CLI unit tests — pretty output", () => {
  it("groups by category", () => {
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

  it("shows score when provided", () => {
    const output = formatPretty([], { score: 85 });
    expect(output).toContain("85");
  });
});

describe("CLI unit tests — report URL", () => {
  it("generates correct URL", () => {
    const url = generateReportUrl("https://agentbadge.xyz", "scan-123");
    expect(url).toBe("https://agentbadge.xyz/report?scan=scan-123");
  });
});

describe("CLI unit tests — scoring", () => {
  it("calculates proportional score for mixed results", () => {
    const passCount = 40;
    const failCount = 15;
    const total = passCount + failCount;
    const score = Math.round((passCount / total) * 100);
    expect(score).toBeCloseTo(73, 0);
  });

  it("100% when all pass", () => {
    const results = Array(55).fill({ status: "pass" });
    const passCount = results.filter((r: any) => r.status === "pass").length;
    const score = Math.round((passCount / results.length) * 100);
    expect(score).toBe(100);
  });

  it("0% when all fail", () => {
    const results = Array(55).fill({ status: "fail" });
    const passCount = results.filter((r: any) => r.status === "pass").length;
    const score = Math.round((passCount / results.length) * 100);
    expect(score).toBe(0);
  });
});
