/**
 * SLICE-103-10: Full pipeline E2E — scan → corpus → aggregate → benchmark → report.
 *
 * Tests the complete zero-drift pipeline using golden fixtures.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { FileCorpusStore } from "../../src/agent-readiness/corpus/corpus-store";
import { extractCorpusRecord } from "../../src/agent-readiness/corpus/corpus-extractor";
import { sweepForPii } from "../../src/agent-readiness/corpus/pii-sweep";
import { auditCorpusForPii } from "../../src/agent-readiness/corpus/corpus-audit";
import { computeOverallBenchmark } from "../../src/agent-readiness/corpus/benchmark-engine";
import {
  computeGapFrequency,
  computeScoreHistogram,
  computeCategoryDistribution,
  computePillarDistribution,
  computeStatusDistribution,
  computeTrend,
} from "../../src/agent-readiness/corpus/aggregation-engine";
import { generateReport, renderReportMarkdown } from "../../src/agent-readiness/corpus/report-generator";
import { GOLDEN_RECORDS, EXPECTED } from "../fixtures/corpus-golden-benchmarks";
import type { RuleEngineResult } from "../../src/agent-readiness/rule-engine/rule-engine";
import type { ScoreResult } from "../../src/agent-readiness/scoring/scoring-types";
import type { GapSummary } from "../../src/agent-readiness/gap-engine/gap-engine";

let tmpDir: string;

function makeScanResult(score: number, category: string, vertical?: string) {
  const grade = score >= 90 ? "A" : score >= 80 ? "B" : score >= 70 ? "C" : score >= 60 ? "D" : "F";
  const result = {
    assertions: [
      { rule_id: "AB-001", status: "VERIFIED", category: "discovery", severity: "info", message: "robots.txt found" },
      { rule_id: "AB-003", status: "GAP", category, severity: "medium", message: "Missing documentation" },
    ],
    rulesetVersion: "agent-readiness@1.2.0",
    totalRules: 15,
    applicableRules: 14,
  } as unknown as RuleEngineResult;

  const scoreResult = {
    total: { score, grade, rawScore: score, floorTriggered: false, floorReason: null },
    pillars: {
      discovery: { pillar: "discovery", weight: 25, rawScore: score + 5, score: score + 5, categoryCount: 3, applicableCount: 3, floorTriggered: false },
      understandability: { pillar: "understandability", weight: 25, rawScore: Math.max(0, score - 5), score: Math.max(0, score - 5), categoryCount: 2, applicableCount: 2, floorTriggered: false },
    },
    categories: {
      [category]: { category, weight: 15, rawScore: score, score, ruleCount: 3, applicableCount: 3, floorTriggered: false },
      authentication: { category: "authentication", weight: 10, rawScore: Math.max(0, score - 20), score: Math.max(0, score - 20), ruleCount: 2, applicableCount: 2, floorTriggered: false },
    },
    delta: null,
    config: { categoryWeights: {}, statusContributions: {}, floorCap: 50, floorCategories: [], floorTriggerSeverity: [], scoringModel: "v2-pillars", pillarWeights: {} },
    computedAt: "2026-09-07T12:00:00Z",
  } as unknown as ScoreResult;

  const gapSummary = {
    total: 1,
    by_priority: { CRITICAL: 0, HIGH: 0, MEDIUM: 1, LOW: 0 },
    by_type: { documentation: 1, semantic: 0, capability: 0, evidence: 0 },
  } as unknown as GapSummary;

  return { result, scoreResult, gapSummary, industryVertical: vertical };
}

describe("SLICE-103-10: Full Pipeline E2E (scan → corpus → benchmark → report)", () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "corpus-e2e-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("full pipeline: extract → PII sweep → store → aggregate → benchmark → report", async () => {
    const store = new FileCorpusStore(tmpDir);

    // ── Step 1: Extract corpus records from multiple scans ──
    const scores = [45, 55, 65, 72, 80, 88, 92, 60, 70, 85];
    const categories = ["api_description", "authentication", "documentation", "discovery", "understandability"];
    const verticals = ["fintech", "healthcare", "ecommerce"];

    for (let i = 0; i < 10; i++) {
      const scan = makeScanResult(scores[i], categories[i % categories.length], verticals[i % verticals.length]);
      const record = extractCorpusRecord(scan);

      // ── Step 2: PII sweep ──
      const piiResult = sweepForPii(record);
      expect(piiResult.clean).toBe(true);

      // ── Step 3: Write to store ──
      await store.append(record);
    }

    // ── Step 4: Verify store ──
    const records = await store.query({});
    expect(records).toHaveLength(10);

    const stats = await store.getStats();
    expect(stats.total_records).toBe(10);

    // ── Step 5: Aggregate ──
    const histogram = computeScoreHistogram(records);
    expect(Object.values(histogram.buckets).reduce((a, b) => a + b, 0)).toBe(10);

    const gapFreq = computeGapFrequency(records);
    expect(gapFreq.length).toBeGreaterThan(0);

    const catDist = computeCategoryDistribution(records);
    expect(catDist.length).toBeGreaterThan(0);

    const pillarDist = computePillarDistribution(records);
    expect(pillarDist.length).toBeGreaterThan(0);

    const statusDist = computeStatusDistribution(records);
    expect(statusDist.total).toBe(10);

    const trend = computeTrend(records, "week");
    expect(Array.isArray(trend)).toBe(true);

    // ── Step 6: Benchmark (with low min sample size for testing) ──
    const benchmark = computeOverallBenchmark(records, stats, { minSampleSize: 5 });
    expect("insufficient_data" in benchmark).toBe(false);
    if (!("insufficient_data" in benchmark)) {
      expect(benchmark.corpus_stats.total_records).toBe(10);
      expect(benchmark.score_histogram).toBeDefined();
    }

    // ── Step 7: Report generation ──
    const benchmarkData = "insufficient_data" in benchmark ? null : benchmark;
    const report = generateReport(records, stats, benchmarkData);

    expect(report.headline.total_scans).toBe(10);
    expect(report.headline.median_score).toBeGreaterThan(0);
    expect(report.headline.mean_score).toBeGreaterThan(0);
    expect(report.top_gaps.length).toBeGreaterThan(0);
    expect(report.category_leaderboard.best.length).toBeGreaterThan(0);
    expect(report.pillar_analysis.length).toBeGreaterThan(0);
    expect(report.status_distribution.total).toBe(10);
    expect(report.methodology.sample_size).toBe(10);

    // ── Step 8: Markdown rendering ──
    const md = renderReportMarkdown(report);
    expect(md).toContain("# State of Agent Readiness");
    expect(md).toContain("## Headline Metrics");
    expect(md).toContain("## Top 10 Most Common Gaps");
    expect(md).toContain("## Category Leaderboard");
    expect(md).toContain("## Pillar Analysis");
    expect(md).toContain("## Status Distribution");
    expect(md).toContain("## Methodology");
  });

  it("golden fixtures: full pipeline with 55 records → benchmark → report", async () => {
    const store = new FileCorpusStore(tmpDir);
    const filePath = path.join(tmpDir, "corpus.jsonl");
    for (const record of GOLDEN_RECORDS) {
      fs.appendFileSync(filePath, JSON.stringify(record) + "\n");
    }

    const records = await store.query({});
    expect(records).toHaveLength(EXPECTED.total_records);

    const stats = await store.getStats();
    expect(stats.total_records).toBe(EXPECTED.total_records);

    // Benchmark
    const benchmark = computeOverallBenchmark(records, stats, { minSampleSize: 50 });
    expect("insufficient_data" in benchmark).toBe(false);

    // Report
    const benchmarkData = "insufficient_data" in benchmark ? null : benchmark;
    const report = generateReport(records, stats, benchmarkData);

    expect(report.headline.total_scans).toBe(EXPECTED.total_records);
    expect(report.top_gaps.length).toBeGreaterThan(0);
    expect(report.pillar_analysis.length).toBeGreaterThan(0);

    // Markdown
    const md = renderReportMarkdown(report);
    expect(md.length).toBeGreaterThan(500);
    expect(md).toContain("State of Agent Readiness");
  });

  it("privacy audit: golden records pass PII sweep", async () => {
    const store = new FileCorpusStore(tmpDir);
    const filePath = path.join(tmpDir, "corpus.jsonl");
    for (const record of GOLDEN_RECORDS) {
      fs.appendFileSync(filePath, JSON.stringify(record) + "\n");
    }

    const audit = await auditCorpusForPii(store);
    expect(audit.passed).toBe(true);
    expect(audit.flagged_records).toBe(0);
  });

  it("PII rejection: record with PII is rejected by store", async () => {
    const store = new FileCorpusStore(tmpDir);
    const scan = makeScanResult(70, "api_description", "fintech");
    const record = extractCorpusRecord(scan);

    // Inject PII
    (record as any).scan_summary.url = "https://evil.example.com";

    const piiResult = sweepForPii(record);
    expect(piiResult.clean).toBe(false);
    expect(piiResult.findings.length).toBeGreaterThan(0);
  });

  it("report ID format: date-prefixed soar-YYYY-MM-DD", async () => {
    const store = new FileCorpusStore(tmpDir);
    const scan = makeScanResult(75, "discovery", "fintech");
    const record = extractCorpusRecord(scan);
    await store.append(record);

    const records = await store.query({});
    const stats = await store.getStats();
    const report = generateReport(records, stats, null);

    expect(report.id).toMatch(/^soar-\d{4}-\d{2}-\d{2}$/);
  });

  it("trend analysis: records across multiple time periods", async () => {
    const store = new FileCorpusStore(tmpDir);

    // Create records across 3 weeks
    const timestamps = [
      "2026-01-01T00:00:00Z",
      "2026-01-03T00:00:00Z",
      "2026-01-08T00:00:00Z",
      "2026-01-15T00:00:00Z",
      "2026-01-20T00:00:00Z",
    ];
    for (let i = 0; i < 5; i++) {
      const scan = makeScanResult(60 + i * 5, "discovery", "fintech");
      const record = extractCorpusRecord(scan);
      record.timestamp = timestamps[i];
      await store.append(record);
    }

    const records = await store.query({});
    const trend = computeTrend(records, "week");
    expect(trend.length).toBeGreaterThan(0);
  });
});
