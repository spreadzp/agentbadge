import { describe, it, expect } from "vitest";
import { formatScanReport } from "../../src/agent-readiness/report-formatter";
import type { RuleEngineResult } from "../../src/agent-readiness/rule-engine/rule-engine";
import type { Assertion } from "../../src/agent-readiness/rule-engine/assertion-builder";

function makeAssertion(overrides: Partial<Assertion>): Assertion {
  return {
    rule_id: overrides.rule_id ?? "AB-001",
    rule_version: overrides.rule_version ?? "1.0.0",
    status: overrides.status ?? "VERIFIED",
    evidence: overrides.evidence ?? [],
    confidence: overrides.confidence ?? 1.0,
    timestamp: overrides.timestamp ?? "2026-01-01T00:00:00Z",
    source_url: overrides.source_url ?? "https://example.com",
    reason: overrides.reason ?? "test",
    category: overrides.category ?? "discovery",
    name: overrides.name ?? "test rule",
    ...overrides,
  } as Assertion;
}

function makeResult(assertions: Assertion[]): RuleEngineResult {
  return {
    assertions,
    rulesetVersion: "1.0.0",
    scannedAt: "2026-01-01T00:00:00Z",
    totalRules: assertions.length,
    applicableRules: assertions.length,
  };
}

describe("SLICE-58-6: Total scan report formatter", () => {
  it("produces a ScanReport with score, grade, and summary", () => {
    const result = makeResult([
      makeAssertion({ rule_id: "AB-001", status: "VERIFIED", category: "discovery" }),
      makeAssertion({ rule_id: "AB-002", status: "MISSING", category: "discovery" }),
    ]);
    const report = formatScanReport("https://example.com", result);
    expect(report.score).toBe(50);
    expect(report.grade).toBe("C");
    expect(report.summary).toContain("50/100");
    expect(report.summary).toContain("C");
  });

  it("grade A for score >= 80", () => {
    const result = makeResult([
      makeAssertion({ rule_id: "AB-001", status: "VERIFIED" }),
      makeAssertion({ rule_id: "AB-002", status: "VERIFIED" }),
      makeAssertion({ rule_id: "AB-003", status: "VERIFIED" }),
      makeAssertion({ rule_id: "AB-004", status: "VERIFIED" }),
      makeAssertion({ rule_id: "AB-005", status: "MISSING" }),
    ]);
    const report = formatScanReport("https://example.com", result);
    expect(report.score).toBe(80);
    expect(report.grade).toBe("A");
  });

  it("grade F for score < 20", () => {
    const result = makeResult([
      makeAssertion({ rule_id: "AB-001", status: "MISSING" }),
      makeAssertion({ rule_id: "AB-002", status: "MISSING" }),
      makeAssertion({ rule_id: "AB-003", status: "MISSING" }),
      makeAssertion({ rule_id: "AB-004", status: "MISSING" }),
      makeAssertion({ rule_id: "AB-005", status: "MISSING" }),
    ]);
    const report = formatScanReport("https://example.com", result);
    expect(report.score).toBe(0);
    expect(report.grade).toBe("F");
  });

  it("categories sorted by completeness (highest first)", () => {
    const result = makeResult([
      makeAssertion({ rule_id: "AB-001", status: "VERIFIED", category: "discovery" }),
      makeAssertion({ rule_id: "AB-002", status: "MISSING", category: "discovery" }),
      makeAssertion({ rule_id: "AB-004", status: "VERIFIED", category: "documentation" }),
      makeAssertion({ rule_id: "AB-005", status: "VERIFIED", category: "documentation" }),
    ]);
    const report = formatScanReport("https://example.com", result);
    expect(report.categories.length).toBe(2);
    // documentation has 100% completeness, discovery has 50%
    expect(report.categories[0].category).toBe("documentation");
    expect(report.categories[0].completeness_pct).toBe(100);
    expect(report.categories[1].category).toBe("discovery");
    expect(report.categories[1].completeness_pct).toBe(50);
  });

  it("top_missing sorted by effort (quick wins first)", () => {
    const result = makeResult([
      makeAssertion({ rule_id: "AB-045", status: "MISSING", category: "infrastructure" }),
      makeAssertion({ rule_id: "AB-004", status: "MISSING", category: "documentation" }),
      makeAssertion({ rule_id: "AB-001", status: "MISSING", category: "discovery" }),
    ]);
    const report = formatScanReport("https://example.com", result);
    expect(report.top_missing.length).toBe(3);
    // AB-001 and AB-045 are "quick", AB-004 is "complex"
    expect(report.top_missing[0].effort_hint).toBe("quick");
    expect(report.top_missing[1].effort_hint).toBe("quick");
    expect(report.top_missing[2].effort_hint).toBe("complex");
  });

  it("does not include raw evidence in report", () => {
    const result = makeResult([
      makeAssertion({ rule_id: "AB-001", status: "VERIFIED", evidence: [{ type: "robots", url: "https://example.com/robots.txt" }] }),
    ]);
    const report = formatScanReport("https://example.com", result);
    const reportJson = JSON.stringify(report);
    expect(reportJson).not.toContain('"evidence"');
    expect(reportJson).not.toContain('robots.txt');
  });

  it("summary is human-readable and includes counts", () => {
    const result = makeResult([
      makeAssertion({ rule_id: "AB-001", status: "VERIFIED" }),
      makeAssertion({ rule_id: "AB-002", status: "VERIFIED" }),
      makeAssertion({ rule_id: "AB-003", status: "MISSING" }),
      makeAssertion({ rule_id: "AB-004", status: "NOT_APPLICABLE" }),
    ]);
    const report = formatScanReport("https://example.com", result);
    expect(report.summary).toContain("2 of 4 rules passed");
    expect(report.summary).toContain("1 need attention");
    expect(report.summary).toContain("1 not applicable");
  });

  it("counts verified and inferred together", () => {
    const result = makeResult([
      makeAssertion({ rule_id: "AB-001", status: "VERIFIED" }),
      makeAssertion({ rule_id: "AB-002", status: "INFERRED" }),
      makeAssertion({ rule_id: "AB-003", status: "MISSING" }),
      makeAssertion({ rule_id: "AB-004", status: "MISSING" }),
    ]);
    const report = formatScanReport("https://example.com", result);
    expect(report.verified).toBe(2);
    expect(report.missing).toBe(2);
    expect(report.score).toBe(50);
  });
});
