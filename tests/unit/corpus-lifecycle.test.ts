/**
 * SLICE-103-10: E2E corpus lifecycle tests.
 *
 * Tests the full pipeline: scan → corpus write → aggregate → benchmark → report.
 * Uses golden fixtures for deterministic regression testing.
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
import { computeScoreHistogram, computeTrend } from "../../src/agent-readiness/corpus/aggregation-engine";
import { GOLDEN_RECORDS, EXPECTED } from "../fixtures/corpus-golden-benchmarks";
import type { RuleEngineResult } from "../../src/agent-readiness/rule-engine/rule-engine";
import type { ScoreResult } from "../../src/agent-readiness/scoring/scoring-types";

let tmpDir: string;

function makeScanResult(score: number, category: string): { result: RuleEngineResult; scoreResult: ScoreResult } {
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
      understandability: { pillar: "understandability", weight: 25, rawScore: score - 5, score: Math.max(0, score - 5), categoryCount: 2, applicableCount: 2, floorTriggered: false },
    },
    categories: {
      [category]: { category, weight: 15, rawScore: score, score, ruleCount: 3, applicableCount: 3, floorTriggered: false },
      authentication: { category: "authentication", weight: 10, rawScore: Math.max(0, score - 20), score: Math.max(0, score - 20), ruleCount: 2, applicableCount: 2, floorTriggered: false },
    },
    delta: null,
    config: { categoryWeights: {}, statusContributions: {}, floorCap: 50, floorCategories: [], floorTriggerSeverity: [], scoringModel: "v2-pillars", pillarWeights: {} },
    computedAt: "2025-09-06T12:00:00Z",
  } as unknown as ScoreResult;

  return { result, scoreResult };
}

describe("SLICE-103-10: Corpus Lifecycle E2E", () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "corpus-lifecycle-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("scan → corpus write → aggregate → benchmark", async () => {
    const store = new FileCorpusStore(tmpDir);
    const { result, scoreResult } = makeScanResult(72, "api_description");

    // 1. Extract corpus record
    const record = extractCorpusRecord({ result, scoreResult, industryVertical: "fintech" });

    // 2. PII sweep
    expect(sweepForPii(record).clean).toBe(true);

    // 3. Write to store
    await store.append(record);

    // 4. Read back
    const records = await store.query({});
    expect(records).toHaveLength(1);

    // 5. Aggregate — histogram
    const { buckets: histogram, total } = computeScoreHistogram(records);
    expect(total).toBe(1);
    expect(Object.values(histogram).reduce((a, b) => a + b, 0)).toBe(1);

    // 6. Benchmark (will be insufficient data with 1 record)
    const stats = await store.getStats();
    const benchmark = computeOverallBenchmark(records, stats, { minSampleSize: 50 });
    expect("insufficient_data" in benchmark).toBe(true);
  });

  it("multiple scans → corpus growth → benchmark update", async () => {
    const store = new FileCorpusStore(tmpDir);
    const scores = [40, 50, 60, 70, 80];
    const categories = ["api_description", "authentication", "documentation", "discovery", "understandability"];

    for (let i = 0; i < 5; i++) {
      const { result, scoreResult } = makeScanResult(scores[i], categories[i]);
      const record = extractCorpusRecord({ result, scoreResult, industryVertical: "fintech" });
      await store.append(record);
    }

    const records = await store.query({});
    expect(records).toHaveLength(5);

    const stats = await store.getStats();
    expect(stats.total_records).toBe(5);

    // Benchmark with low min sample size
    const benchmark = computeOverallBenchmark(records, stats, { minSampleSize: 5 });
    expect("insufficient_data" in benchmark).toBe(false);
    if (!("insufficient_data" in benchmark)) {
      expect(benchmark.corpus_stats.total_records).toBe(5);
    }
  });

  it("golden fixtures: 55 records → benchmark with correct stats", async () => {
    const store = new FileCorpusStore(tmpDir);
    const filePath = path.join(tmpDir, "corpus.jsonl");
    for (const record of GOLDEN_RECORDS) {
      fs.appendFileSync(filePath, JSON.stringify(record) + "\n");
    }

    const records = await store.query({});
    expect(records).toHaveLength(EXPECTED.total_records);

    const stats = await store.getStats();
    expect(stats.total_records).toBe(EXPECTED.total_records);

    const benchmark = computeOverallBenchmark(records, stats, { minSampleSize: 50 });
    expect("insufficient_data" in benchmark).toBe(false);
    if (!("insufficient_data" in benchmark)) {
      expect(benchmark.corpus_stats.total_records).toBe(EXPECTED.total_records);
      expect(benchmark.score_histogram).toBeDefined();
      const totalInHistogram = Object.values(benchmark.score_histogram).reduce((a, b) => a + b, 0);
      expect(totalInHistogram).toBe(EXPECTED.total_records);
    }
  });

  it("golden fixtures: histogram matches expected distribution", async () => {
    const { buckets } = computeScoreHistogram(GOLDEN_RECORDS);
    expect(buckets["40-50"]).toBe(EXPECTED.histogram["40-50"]);
    expect(buckets["50-60"]).toBe(EXPECTED.histogram["50-60"]);
    expect(buckets["60-70"]).toBe(EXPECTED.histogram["60-70"]);
    expect(buckets["70-80"]).toBe(EXPECTED.histogram["70-80"]);
    expect(buckets["80-90"]).toBe(EXPECTED.histogram["80-90"]);
    expect(buckets["90-100"]).toBe(EXPECTED.histogram["90-100"]);
  });

  it("golden fixtures: privacy audit passes", async () => {
    const store = new FileCorpusStore(tmpDir);
    const filePath = path.join(tmpDir, "corpus.jsonl");
    for (const record of GOLDEN_RECORDS) {
      fs.appendFileSync(filePath, JSON.stringify(record) + "\n");
    }

    const audit = await auditCorpusForPii(store);
    expect(audit.passed).toBe(true);
    expect(audit.total_records).toBe(EXPECTED.total_records);
    expect(audit.flagged_records).toBe(0);
  });

  it("golden fixtures: trend computation works", async () => {
    const trend = computeTrend(GOLDEN_RECORDS, "month");
    expect(Array.isArray(trend)).toBe(true);
    expect(trend.length).toBeGreaterThan(0);
  });
});
