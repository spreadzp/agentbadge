import { describe, it, expect } from "vitest";
import { formatCiSummary } from "../../../src/agent-readiness/ci/ci-summary";
import type { AgentReadinessReport } from "../../../src/agent-readiness/integrity/report-serializer";

function makeReport(overrides?: Partial<AgentReadinessReport>): AgentReadinessReport {
  return {
    report_id: "01HTEST0000000000000000001",
    schema_version: "0.1.0",
    ruleset: { name: "agent-readiness", version: "1.2.0" },
    scope: {
      agent_id: "test-api",
      agent_version: "1.0",
      endpoint_base_url: "https://test.com",
      timestamp: "2025-01-15T10:00:00.000Z",
    },
    scanned_at: "2025-01-15T10:00:00.000Z",
    previous_hash: null,
    score: {
      overall: 85,
      categories: {
        discovery: 90,
        documentation: 80,
        actionability: 70,
        machine_readable: 85,
        verification: 60,
      },
    },
    assertions: [
      { rule_id: "AB-001", status: "PASS", reason: "robots.txt found", confidence: 0.95 },
      { rule_id: "AB-002", status: "MISSING", reason: "No sitemap.xml", confidence: 0.9, severity: "medium" },
      { rule_id: "AB-003", status: "CONFLICT", reason: "Conflicting endpoints", confidence: 0.85, severity: "high" },
    ],
    integrity: {
      content_hash: "a".repeat(64),
      signature: { algorithm: "ed25519", key_id: "k", value: "" },
    },
    ...overrides,
  } as unknown as AgentReadinessReport;
}

describe("SLICE-39-3: CI Summary Formatter", () => {
  it("produces markdown with heading", () => {
    const md = formatCiSummary(makeReport());
    expect(md).toContain("## 🏷️ AgentBadge Scan Results");
  });

  it("includes overall score", () => {
    const md = formatCiSummary(makeReport({ score: { overall: 92, categories: {} } } as any));
    expect(md).toContain("92/100");
    expect(md).toContain("🟢");
  });

  it("shows yellow emoji for 70-89", () => {
    const md = formatCiSummary(makeReport({ score: { overall: 75, categories: {} } } as any));
    expect(md).toContain("🟡");
  });

  it("shows red emoji for <70", () => {
    const md = formatCiSummary(makeReport({ score: { overall: 50, categories: {} } } as any));
    expect(md).toContain("🔴");
  });

  it("includes scope URL", () => {
    const md = formatCiSummary(makeReport());
    expect(md).toContain("https://test.com");
  });

  it("includes ruleset version", () => {
    const md = formatCiSummary(makeReport());
    expect(md).toContain("agent-readiness v1.2.0");
  });

  it("includes report ID", () => {
    const md = formatCiSummary(makeReport());
    expect(md).toContain("01HTEST0000000000000000001");
  });

  it("includes category breakdown table", () => {
    const md = formatCiSummary(makeReport());
    expect(md).toContain("### Category Breakdown");
    expect(md).toContain("discovery");
    expect(md).toContain("documentation");
    expect(md).toContain("| Category | Score | Status |");
  });

  it("includes issues section", () => {
    const md = formatCiSummary(makeReport());
    expect(md).toContain("### Issues Found");
    expect(md).toContain("AB-002");
    expect(md).toContain("AB-003");
  });

  it("does not include issues section when none", () => {
    const md = formatCiSummary(makeReport({
      assertions: [{ rule_id: "AB-001", status: "PASS", reason: "ok", confidence: 0.95 }],
    }));
    expect(md).not.toContain("### Issues Found");
  });

  it("shows regression warning for negative delta", () => {
    const md = formatCiSummary(makeReport({
      score: { overall: 75, categories: {}, delta: -10 } as any,
    }));
    expect(md).toContain("⚠️ Regression Detected");
    expect(md).toContain("10");
  });

  it("does not show regression for positive delta", () => {
    const md = formatCiSummary(makeReport({
      score: { overall: 85, categories: {}, delta: 5 } as any,
    }));
    expect(md).not.toContain("⚠️ Regression Detected");
  });

  it("includes delta in metrics table", () => {
    const md = formatCiSummary(makeReport({
      score: { overall: 85, categories: {}, delta: 5 } as any,
    }));
    expect(md).toContain("**Delta**");
    expect(md).toContain("+5");
    expect(md).toContain("📈");
  });

  it("includes low confidence section", () => {
    const md = formatCiSummary(makeReport({
      assertions: [
        { rule_id: "AB-001", status: "PASS", reason: "ok", confidence: 0.5 },
      ],
    }));
    expect(md).toContain("Low Confidence");
    expect(md).toContain("0.50");
  });

  it("truncates issues to 10 with summary", () => {
    const manyIssues = Array.from({ length: 15 }, (_, i) => ({
      rule_id: `AB-${String(i).padStart(3, "0")}`,
      status: "MISSING",
      reason: `Issue ${i}`,
      confidence: 0.9,
    }));
    const md = formatCiSummary(makeReport({ assertions: manyIssues as any }));
    expect(md).toContain("...and 5 more");
  });

  it("is pure function (deterministic)", () => {
    const report = makeReport();
    expect(formatCiSummary(report)).toBe(formatCiSummary(report));
  });

  it("handles missing categories gracefully", () => {
    const md = formatCiSummary(makeReport({ score: { overall: 50, categories: {} } as any }));
    expect(md).toContain("50/100");
    expect(md).not.toContain("### Category Breakdown");
  });

  it("handles score.total fallback", () => {
    const md = formatCiSummary(makeReport({
      score: { total: 77, categories: {} } as any,
    }));
    expect(md).toContain("77/100");
  });
});
