import { describe, it, expect } from "vitest";
import { parseArgs, type ParsedFlags } from "../src/agent-readiness/cli/router";
import { shouldFailCi, shouldFailThreshold, formatJsonOutput, formatFixOutput } from "../src/agent-readiness/cli/output";

const SCAN_FLAGS = [
  { name: "json", shortName: "j", type: "boolean" as const, description: "Output JSON" },
  { name: "ci", shortName: "", type: "boolean" as const, description: "CI mode" },
  { name: "fix", shortName: "", type: "boolean" as const, description: "Fix suggestions" },
  { name: "diff", shortName: "", type: "string" as const, description: "Diff file" },
  { name: "threshold", shortName: "", type: "string" as const, description: "Threshold" },
];

describe("CLI flags — parsing", () => {
  it("--json parses as boolean true", () => {
    const result = parseArgs(["example.com", "--json"], SCAN_FLAGS);
    expect(result.flags.json).toBe(true);
  });

  it("--ci parses as boolean true", () => {
    const result = parseArgs(["example.com", "--ci"], SCAN_FLAGS);
    expect(result.flags.ci).toBe(true);
  });

  it("--fix parses as boolean true", () => {
    const result = parseArgs(["example.com", "--fix"], SCAN_FLAGS);
    expect(result.flags.fix).toBe(true);
  });

  it("--diff accepts file path", () => {
    const result = parseArgs(["example.com", "--diff", "previous.json"], SCAN_FLAGS);
    expect(result.flags.diff).toBe("previous.json");
  });

  it("--threshold accepts number string", () => {
    const result = parseArgs(["example.com", "--threshold", "80"], SCAN_FLAGS);
    expect(result.flags.threshold).toBe("80");
  });

  it("flags can be combined", () => {
    const result = parseArgs(["example.com", "--json", "--ci", "--threshold", "80"], SCAN_FLAGS);
    expect(result.flags.json).toBe(true);
    expect(result.flags.ci).toBe(true);
    expect(result.flags.threshold).toBe("80");
  });
});

describe("CLI flags — CI mode", () => {
  it("fails on any rule failure", () => {
    const results = [{ status: "fail" }, { status: "pass" }];
    expect(shouldFailCi(results as any)).toBe(true);
  });

  it("passes when all rules pass", () => {
    const results = [{ status: "pass" }, { status: "pass" }];
    expect(shouldFailCi(results as any)).toBe(false);
  });
});

describe("CLI flags — threshold", () => {
  it("fails below threshold", () => {
    expect(shouldFailThreshold(50, 80)).toBe(true);
  });

  it("passes at threshold", () => {
    expect(shouldFailThreshold(80, 80)).toBe(false);
  });

  it("passes above threshold", () => {
    expect(shouldFailThreshold(90, 80)).toBe(false);
  });
});

describe("CLI flags — JSON output", () => {
  it("outputs valid JSON", () => {
    const results = [{ rule_id: "AB-001", status: "pass" }];
    const output = formatJsonOutput(results as any);
    expect(() => JSON.parse(output)).not.toThrow();
  });
});

describe("CLI flags — fix output", () => {
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
});
