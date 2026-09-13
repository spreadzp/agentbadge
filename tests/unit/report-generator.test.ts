/**
 * SLICE-103-6: Tests for "State of Agent Readiness" report generator.
 */

import { describe, it, expect } from "vitest";
import { generateReport, renderReportMarkdown } from "../../src/agent-readiness/corpus/report-generator";
import type { CorpusRecord } from "../../src/agent-readiness/corpus/corpus-record.schema";
import type { CorpusStats } from "../../src/agent-readiness/corpus/corpus-store";
import { createTestRecord } from "./corpus-fixtures";

function createStats(records: CorpusRecord[]): CorpusStats {
  if (records.length === 0) {
    return { total_records: 0, date_range: { earliest: "", latest: "" }, ruleset_versions: [], verticals: [] };
  }
  const versions = new Set<string>();
  const verticals = new Set<string>();
  let earliest = records[0].timestamp;
  let latest = records[0].timestamp;
  for (const r of records) {
    versions.add(r.ruleset_version);
    if (r.industry_vertical) verticals.add(r.industry_vertical);
    if (r.timestamp < earliest) earliest = r.timestamp;
    if (r.timestamp > latest) latest = r.timestamp;
  }
  return {
    total_records: records.length,
    date_range: { earliest, latest },
    ruleset_versions: [...versions],
    verticals: [...verticals],
  };
}

describe("SLICE-103-6: report-generator", () => {
  it("generates a report with correct headline metrics", () => {
    const records: CorpusRecord[] = [
      createTestRecord({ score: 80, grade: "B", gap_ids: ["gap:capability:auth"] }),
      createTestRecord({ score: 60, grade: "C", gap_ids: ["gap:documentation:pricing"] }),
      createTestRecord({ score: 90, grade: "A", gap_ids: [] }),
    ];
    const stats = createStats(records);

    const report = generateReport(records, stats, null);

    expect(report.headline.total_scans).toBe(3);
    expect(report.headline.median_score).toBe(80);
    expect(report.headline.mean_score).toBe(76.7);
    expect(report.headline.pct_with_auth_gaps).toBe(33.3);
    expect(report.headline.pct_with_pricing_gaps).toBe(33.3);
    expect(report.headline.pct_with_runtime_traces).toBe(0);
  });

  it("generates report with top gaps sorted by frequency", () => {
    const records: CorpusRecord[] = [
      createTestRecord({ gap_ids: ["gap:capability:auth", "gap:documentation:pricing"] }),
      createTestRecord({ gap_ids: ["gap:capability:auth"] }),
      createTestRecord({ gap_ids: ["gap:capability:auth", "gap:semantic:errors"] }),
    ];
    const stats = createStats(records);

    const report = generateReport(records, stats, null);

    expect(report.top_gaps.length).toBeGreaterThan(0);
    expect(report.top_gaps[0].gap_id).toBe("gap:capability:auth");
    expect(report.top_gaps[0].frequency).toBe(3);
    expect(report.top_gaps[0].pct).toBe(100);
  });

  it("generates report with category leaderboard", () => {
    const records: CorpusRecord[] = [
      createTestRecord({ category_scores: { auth: 90, pricing: 30, docs: 80 } }),
      createTestRecord({ category_scores: { auth: 70, pricing: 40, docs: 85 } }),
      createTestRecord({ category_scores: { auth: 80, pricing: 20, docs: 75 } }),
    ];
    const stats = createStats(records);

    const report = generateReport(records, stats, null);

    expect(report.category_leaderboard.best.length).toBeLessThanOrEqual(5);
    expect(report.category_leaderboard.worst.length).toBeLessThanOrEqual(5);
    // Best should have highest median
    expect(report.category_leaderboard.best[0].median).toBeGreaterThanOrEqual(
      report.category_leaderboard.worst[0].median,
    );
  });

  it("generates report with pillar analysis", () => {
    const records: CorpusRecord[] = [
      createTestRecord({ pillar_scores: { discovery: 85, executability: 70 } }),
      createTestRecord({ pillar_scores: { discovery: 75, executability: 65 } }),
    ];
    const stats = createStats(records);

    const report = generateReport(records, stats, null);

    expect(report.pillar_analysis.length).toBe(2);
    expect(report.pillar_analysis[0].pillar).toBe("discovery");
  });

  it("generates report with status distribution", () => {
    const records: CorpusRecord[] = [
      createTestRecord({ status_counts: { VERIFIED: 10, INFERRED: 2, GAP: 3, CONFLICT: 0, NOT_APPLICABLE: 1 } }),
      createTestRecord({ status_counts: { VERIFIED: 8, INFERRED: 1, GAP: 5, CONFLICT: 1, NOT_APPLICABLE: 2 } }),
    ];
    const stats = createStats(records);

    const report = generateReport(records, stats, null);

    expect(report.status_distribution.VERIFIED).toBe(18);
    expect(report.status_distribution.GAP).toBe(8);
    expect(report.status_distribution.total).toBe(2);
  });

  it("generates report with trend data", () => {
    const records: CorpusRecord[] = [
      createTestRecord({ timestamp: "2026-01-01T00:00:00Z" }),
      createTestRecord({ timestamp: "2026-01-08T00:00:00Z" }),
      createTestRecord({ timestamp: "2026-01-15T00:00:00Z" }),
    ];
    const stats = createStats(records);

    const report = generateReport(records, stats, null);

    expect(report.trend.length).toBeGreaterThan(0);
    expect(report.trend[0].record_count).toBeGreaterThan(0);
  });

  it("generates report with vertical comparison when verticals declared", () => {
    const records: CorpusRecord[] = [
      createTestRecord({ industry_vertical: "fintech", score: 80 }),
      createTestRecord({ industry_vertical: "fintech", score: 70 }),
      createTestRecord({ industry_vertical: "healthcare", score: 60 }),
    ];
    const stats = createStats(records);

    const report = generateReport(records, stats, null);

    expect(report.vertical_comparison.length).toBe(2);
    const fintech = report.vertical_comparison.find((v) => v.vertical === "fintech");
    expect(fintech).toBeDefined();
    expect(fintech!.record_count).toBe(2);
  });

  it("generates report with methodology section", () => {
    const records: CorpusRecord[] = [createTestRecord()];
    const stats = createStats(records);

    const report = generateReport(records, stats, null);

    expect(report.methodology.sample_size).toBe(1);
    expect(report.methodology.anonymization).toContain("PII");
    expect(report.methodology.exclusions).toContain("50");
  });

  it("generates report ID with date prefix", () => {
    const records: CorpusRecord[] = [createTestRecord()];
    const stats = createStats(records);

    const report = generateReport(records, stats, null);

    expect(report.id).toMatch(/^soar-\d{4}-\d{2}-\d{2}$/);
    expect(report.title).toContain("State of Agent Readiness");
  });

  it("renders markdown with all sections", () => {
    const records: CorpusRecord[] = [
      createTestRecord({ score: 75, gap_ids: ["gap:capability:auth"], industry_vertical: "fintech" }),
      createTestRecord({ score: 65, gap_ids: ["gap:documentation:pricing"] }),
    ];
    const stats = createStats(records);

    const report = generateReport(records, stats, null);
    const md = renderReportMarkdown(report);

    expect(md).toContain("# State of Agent Readiness");
    expect(md).toContain("## Headline Metrics");
    expect(md).toContain("## Top 10 Most Common Gaps");
    expect(md).toContain("## Category Leaderboard");
    expect(md).toContain("## Pillar Analysis");
    expect(md).toContain("## Status Distribution");
    expect(md).toContain("## Methodology");
  });

  it("renders markdown with vertical comparison when verticals exist", () => {
    const records: CorpusRecord[] = [
      createTestRecord({ industry_vertical: "fintech", score: 80 }),
      createTestRecord({ industry_vertical: "healthcare", score: 60 }),
    ];
    const stats = createStats(records);

    const report = generateReport(records, stats, null);
    const md = renderReportMarkdown(report);

    expect(md).toContain("## Vertical Comparison");
    expect(md).toContain("fintech");
    expect(md).toContain("healthcare");
  });

  it("handles empty corpus gracefully", () => {
    const records: CorpusRecord[] = [];
    const stats = createStats(records);

    const report = generateReport(records, stats, null);

    expect(report.headline.total_scans).toBe(0);
    expect(report.headline.median_score).toBe(0);
    expect(report.top_gaps).toEqual([]);
    expect(report.trend).toEqual([]);
  });
});
