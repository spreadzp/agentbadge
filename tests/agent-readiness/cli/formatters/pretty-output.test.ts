import { describe, it, expect } from "vitest";
import { formatPrettyOutput } from "../../../../src/agent-readiness/cli/formatters/pretty-output";
import type { AgentReadinessReport } from "../../../../src/agent-readiness/integrity/report-serializer";
import type { PillarScore } from "../../../../src/agent-readiness/scoring/scoring-types";

function makePillarScore(overrides: Partial<PillarScore> = {}): PillarScore {
  return {
    pillar: "discovery",
    weight: 20,
    rawScore: 90,
    score: 90,
    categoryCount: 8,
    applicableCount: 8,
    floorTriggered: false,
    ...overrides,
  };
}

function makeReportWithPillars(overrides: Partial<AgentReadinessReport> = {}): AgentReadinessReport {
  return {
    ...makeReport(),
    pillars: {
      discovery: makePillarScore({ pillar: "discovery", weight: 20, rawScore: 90, score: 90 }),
      understandability: makePillarScore({ pillar: "understandability", weight: 25, rawScore: 68, score: 68 }),
      executability: makePillarScore({ pillar: "executability", weight: 30, rawScore: 77, score: 77 }),
      verifiability: makePillarScore({ pillar: "verifiability", weight: 25, rawScore: 72, score: 72 }),
    },
    ...overrides,
  } as AgentReadinessReport;
}

function makeReport(overrides: Partial<AgentReadinessReport> = {}): AgentReadinessReport {
  return {
    report_id: "01HTEST0000000000000000001",
    schema_version: "0.3.0",
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
      { rule_id: "AB-002", rule_version: "1.0.0", status: "GAP", evidence: [], confidence: 0.9, timestamp: "", source_url: "https://example.com/sitemap.xml", reason: "sitemap.xml not found" },
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

  it("renders top issues for GAP and CONFLICT", () => {
    const out = formatPrettyOutput(makeReport());
    expect(out).toContain("Top Issues");
    expect(out).toContain("[GAP]");
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
      score: { overall: 75, grade: "C+", categories: {}, delta: 5 },
    });
    const out = formatPrettyOutput(report);
    expect(out).toContain("Delta");
    expect(out).toContain("+5");
  });

  it("renders letter grade alongside numeric score", () => {
    const out = formatPrettyOutput(makeReport({ score: { overall: 92, grade: "A", categories: {} } }));
    expect(out).toContain("A");
  });

  it("renders grade C+ for score 75-79", () => {
    const out = formatPrettyOutput(makeReport());
    expect(out).toContain("C+");
  });

  it("renders category breakdown with percentage", () => {
    const out = formatPrettyOutput(makeReport());
    expect(out).toContain("Category Breakdown");
    expect(out).toMatch(/discovery.*80/);
    expect(out).toMatch(/documentation.*70/);
    expect(out).toContain("%");
  });

  // SLICE-93-9: Pillar output tests
  describe("pillar output", () => {
    it("renders PILLARS section when report has pillars", () => {
      const out = formatPrettyOutput(makeReportWithPillars());
      expect(out).toContain("PILLARS");
    });

    it("shows all four pillar labels", () => {
      const out = formatPrettyOutput(makeReportWithPillars());
      expect(out).toContain("Discovery");
      expect(out).toContain("Understandability");
      expect(out).toContain("Executability");
      expect(out).toContain("Verifiability");
    });

    it("shows weight-scaled scores in NN/weight format", () => {
      const out = formatPrettyOutput(makeReportWithPillars());
      // discovery: round(90 * 20 / 100) = 18 → 18/20
      expect(out).toContain("18/20");
      // understandability: round(68 * 25 / 100) = 17 → 17/25
      expect(out).toContain("17/25");
      // executability: round(77 * 30 / 100) = 23 → 23/30
      expect(out).toContain("23/30");
      // verifiability: round(72 * 25 / 100) = 18 → 18/25
      expect(out).toContain("18/25");
    });

    it("shows floor annotation when pillar floorTriggered is true", () => {
      const report = makeReportWithPillars({
        pillars: {
          discovery: makePillarScore({ pillar: "discovery", weight: 20, rawScore: 30, score: 30, floorTriggered: true }),
          understandability: makePillarScore({ pillar: "understandability", weight: 25, rawScore: 68, score: 68 }),
          executability: makePillarScore({ pillar: "executability", weight: 30, rawScore: 77, score: 77 }),
          verifiability: makePillarScore({ pillar: "verifiability", weight: 25, rawScore: 72, score: 72 }),
        } as unknown as Record<string, PillarScore>,
      });
      const out = formatPrettyOutput(report);
      expect(out).toContain("floor");
    });

    it("does not render PILLARS section when pillars is missing (degradation)", () => {
      const out = formatPrettyOutput(makeReport());
      expect(out).not.toContain("PILLARS");
    });

    it("renders PILLARS section between score and category breakdown", () => {
      const out = formatPrettyOutput(makeReportWithPillars());
      const pillarsIdx = out.indexOf("PILLARS");
      const categoryIdx = out.indexOf("Category Breakdown");
      expect(pillarsIdx).toBeGreaterThan(-1);
      expect(categoryIdx).toBeGreaterThan(-1);
      expect(pillarsIdx).toBeLessThan(categoryIdx);
    });
  });
});
