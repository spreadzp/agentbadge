import { describe, it, expect } from "vitest";
import { formatPrettyOutput } from "../../../../src/agent-readiness/cli/formatters/pretty-output";
import type { AgentReadinessReport } from "../../../../src/agent-readiness/integrity/report-serializer";

function makeReport(overrides: Partial<AgentReadinessReport> = {}): AgentReadinessReport {
  return {
    report_id: "01HTEST0000000000000000001",
    schema_version: "0.1.0",
    ruleset: { name: "agent-readiness", version: "1.4.0" },
    scope: {
      agent_id: "example.com",
      agent_version: "unknown",
      endpoint_base_url: "https://example.com",
      timestamp: new Date().toISOString(),
    },
    scanned_at: new Date().toISOString(),
    previous_hash: null,
    score: {
      overall: 75,
      categories: { discovery: 80, documentation: 70, actionability: 60, machine_readable: 50, verification: 90 },
    },
    assertions: [
      { rule_id: "AB-001", rule_version: "1.0.0", status: "VERIFIED", evidence: [], confidence: 0.95, timestamp: "", source_url: null, reason: "robots.txt found" },
      { rule_id: "AB-002", rule_version: "1.0.0", status: "MISSING", evidence: [], confidence: 0.9, timestamp: "", source_url: "https://example.com/sitemap.xml", reason: "sitemap.xml not found" },
      { rule_id: "AB-003", rule_version: "1.0.0", status: "CONFLICT", evidence: [], confidence: 0.6, timestamp: "", source_url: null, reason: "agent-guide has conflicting info" },
    ],
    integrity: {
      content_hash: "a".repeat(64),
      signature: { algorithm: "ed25519", key_id: "default", value: "sig" },
    },
    ...overrides,
  };
}

describe("formatPrettyOutput", () => {
  it("renders header with report ID and scope", () => {
    const out = formatPrettyOutput(makeReport());
    expect(out).toContain("AgentBadge Scan Report");
    expect(out).toContain("01HTEST0000000000000000001");
    expect(out).toContain("https://example.com");
  });

  it("renders overall score with bar", () => {
    const out = formatPrettyOutput(makeReport());
    expect(out).toContain("75/100");
    expect(out).toContain("█");
  });

  it("renders category breakdown", () => {
    const out = formatPrettyOutput(makeReport());
    expect(out).toContain("Category Breakdown");
    expect(out).toContain("discovery");
    expect(out).toContain("documentation");
  });

  it("renders top issues for MISSING and CONFLICT", () => {
    const out = formatPrettyOutput(makeReport());
    expect(out).toContain("Top Issues");
    expect(out).toContain("[MISSING]");
    expect(out).toContain("AB-002");
    expect(out).toContain("[CONFLICT]");
    expect(out).toContain("AB-003");
  });

  it("renders low confidence section when confidence < 0.8", () => {
    const out = formatPrettyOutput(makeReport());
    expect(out).toContain("Low Confidence");
    expect(out).toContain("AB-003");
  });

  it("renders delta when present", () => {
    const report = makeReport({
      score: { overall: 75, categories: {}, delta: 5 } as any,
    });
    const out = formatPrettyOutput(report);
    expect(out).toContain("Delta");
    expect(out).toContain("+5");
  });
});
