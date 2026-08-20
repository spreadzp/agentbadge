import { describe, it, expect, beforeEach } from "vitest";
import { clearCommands, runCommand, getCommand } from "../../../../src/agent-readiness/cli/router";
import { registerGuideCommand, generateGuideMarkdown } from "../../../../src/agent-readiness/cli/commands/guide";
import type { Assertion } from "../../../../src/agent-readiness/rule-engine/assertion-builder";

beforeEach(() => {
  clearCommands();
  registerGuideCommand();
});

function makeAssertion(overrides: Partial<Assertion> = {}): Assertion {
  return {
    rule_id: "AB-001",
    rule_version: "1.0.0",
    status: "MISSING",
    evidence: [],
    confidence: 0.9,
    timestamp: "",
    source_url: null,
    reason: "robots.txt not found",
    category: "discovery",
    name: "robots.txt present",
    ...overrides,
  };
}

describe("generateGuideMarkdown", () => {
  it("generates markdown with header containing URL and score", () => {
    const md = generateGuideMarkdown({
      url: "https://example.com",
      score: 72,
      grade: "C",
      assertions: [],
    });
    expect(md).toContain("# Agent Readiness Improvement Guide");
    expect(md).toContain("https://example.com");
    expect(md).toContain("72/100");
    expect(md).toContain("(C)");
  });

  it("groups failing rules by severity (high → medium → low)", () => {
    const md = generateGuideMarkdown({
      url: "https://example.com",
      score: 50,
      grade: "F",
      assertions: [
        makeAssertion({ rule_id: "AB-001", status: "MISSING", reason: "no robots", category: "discovery", name: "robots.txt present" }),
        makeAssertion({ rule_id: "AB-004", status: "MISSING", reason: "no openapi", category: "machine_readable", name: "OpenAPI spec" }),
      ],
      ruleSeverityMap: { "AB-001": "high", "AB-004": "medium" },
    });
    expect(md).toContain("## High Priority");
    expect(md).toContain("## Medium Priority");
    const highIdx = md.indexOf("## High Priority");
    const medIdx = md.indexOf("## Medium Priority");
    expect(highIdx).toBeLessThan(medIdx);
    expect(md).toContain("AB-001");
    expect(md).toContain("AB-004");
  });

  it("includes rule name, problem, and fix for each failing rule", () => {
    const md = generateGuideMarkdown({
      url: "https://example.com",
      score: 60,
      grade: "D",
      assertions: [
        makeAssertion({ rule_id: "AB-001", status: "MISSING", reason: "robots.txt not found", name: "robots.txt present" }),
      ],
      ruleFixMap: { "AB-001": "Add a robots.txt file at the site root allowing agent access." },
    });
    expect(md).toContain("robots.txt present");
    expect(md).toContain("robots.txt not found");
    expect(md).toContain("Add a robots.txt file at the site root");
  });

  it("includes code example when provided", () => {
    const md = generateGuideMarkdown({
      url: "https://example.com",
      score: 60,
      grade: "D",
      assertions: [
        makeAssertion({ rule_id: "AB-001", status: "MISSING", reason: "no robots", name: "robots.txt" }),
      ],
      ruleFixMap: { "AB-001": "Add robots.txt" },
      ruleExampleMap: { "AB-001": "```\nUser-agent: *\nAllow: /\n```" },
    });
    expect(md).toContain("User-agent: *");
    expect(md).toContain("Allow: /");
  });

  it("filters by category when provided", () => {
    const md = generateGuideMarkdown({
      url: "https://example.com",
      score: 50,
      grade: "F",
      assertions: [
        makeAssertion({ rule_id: "AB-001", category: "discovery", name: "robots" }),
        makeAssertion({ rule_id: "AB-004", category: "machine_readable", name: "openapi" }),
      ],
      categoryFilter: "discovery",
    });
    expect(md).toContain("AB-001");
    expect(md).not.toContain("AB-004");
  });

  it("skips VERIFIED and NOT_APPLICABLE assertions", () => {
    const md = generateGuideMarkdown({
      url: "https://example.com",
      score: 80,
      grade: "B",
      assertions: [
        makeAssertion({ rule_id: "AB-001", status: "VERIFIED", name: "robots ok" }),
        makeAssertion({ rule_id: "AB-002", status: "NOT_APPLICABLE", name: "n/a" }),
        makeAssertion({ rule_id: "AB-003", status: "MISSING", name: "missing guide" }),
      ],
    });
    expect(md).not.toContain("AB-001");
    expect(md).not.toContain("AB-002");
    expect(md).toContain("AB-003");
  });

  it("handles empty failing rules gracefully", () => {
    const md = generateGuideMarkdown({
      url: "https://example.com",
      score: 100,
      grade: "A+",
      assertions: [],
    });
    expect(md).toContain("No failing rules found");
  });
});

describe("guide command registration", () => {
  it("is registered with name 'guide'", () => {
    const cmd = getCommand("guide");
    expect(cmd).toBeDefined();
    expect(cmd!.name).toBe("guide");
  });

  it("returns error for missing url argument", async () => {
    const result = await runCommand(["guide"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Missing required argument");
  });
});
