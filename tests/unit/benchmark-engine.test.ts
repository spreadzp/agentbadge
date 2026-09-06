/**
 * SLICE-103-4: Benchmark engine tests.
 */

import { describe, it, expect } from "vitest";
import type { CorpusRecord } from "../../src/agent-readiness/corpus/corpus-record.schema";
import {
  computeOverallBenchmark,
  computeCategoryBenchmark,
  computePillarBenchmark,
} from "../../src/agent-readiness/corpus/benchmark-engine";
import type { CorpusStats } from "../../src/agent-readiness/corpus/corpus-store";

function makeRecord(overrides: Partial<CorpusRecord> = {}): CorpusRecord {
  return {
    record_id: `01JAR5X7M2K3N4P5Q6R7S8T9V${Math.floor(Math.random() * 900 + 100)}`,
    timestamp: "2025-06-01T12:00:00Z",
    ruleset_version: "agent-readiness@1.2.0",
    schema_version: "0.11.0",
    scan_summary: {
      score: 70,
      grade: "B",
      total_rules: 15,
      applicable_rules: 14,
      status_counts: { VERIFIED: 10, INFERRED: 2, GAP: 1, CONFLICT: 0, NOT_APPLICABLE: 1 },
      pillar_scores: { discovery: 75, understandability: 65 },
    },
    category_scores: { api_description: 80, authentication: 60 },
    gap_pattern: {
      gap_ids: ["gap:api_description:pricing"],
      gap_types: { documentation: 1 },
      gap_priorities: { CRITICAL: 0, HIGH: 0, MEDIUM: 1, LOW: 0 },
    },
    conflict_rules: [],
    industry_vertical: "fintech",
    has_runtime_trace: false,
    ...overrides,
  };
}

function makeStats(total: number): CorpusStats {
  return {
    total_records: total,
    date_range: { earliest: "2025-01-01T00:00:00Z", latest: "2025-06-01T00:00:00Z" },
    ruleset_versions: ["agent-readiness@1.2.0"],
    verticals: ["fintech"],
  };
}

// Generate 55 records for benchmark tests
function makeBenchmarkRecords(count: number): CorpusRecord[] {
  return Array.from({ length: count }, (_, i) =>
    makeRecord({
      record_id: `01JAR5X7M2K3N4P5Q6R7S8T${String(i).padStart(3, "0")}`,
      scan_summary: {
        ...makeRecord().scan_summary,
        score: 50 + (i % 50),
      },
      category_scores: { api_description: 60 + (i % 40), authentication: 40 + (i % 50) },
    }),
  );
}

const config = { minSampleSize: 5 }; // Low threshold for testing

describe("SLICE-103-4: benchmark-engine", () => {
  describe("computeOverallBenchmark", () => {
    it("returns insufficient_data when below threshold", () => {
      const records = makeBenchmarkRecords(3);
      const result = computeOverallBenchmark(records, makeStats(3), { minSampleSize: 50 });
      expect("insufficient_data" in result).toBe(true);
      if ("insufficient_data" in result) {
        expect(result.sample_count).toBe(3);
      }
    });

    it("returns OverallBenchmark when above threshold", () => {
      const records = makeBenchmarkRecords(55);
      const result = computeOverallBenchmark(records, makeStats(55), config);
      expect("insufficient_data" in result).toBe(false);
      if (!("insufficient_data" in result)) {
        expect(result.corpus_stats.total_records).toBe(55);
        expect(result.score_histogram).toBeDefined();
        expect(result.category_benchmarks.length).toBeGreaterThan(0);
        expect(result.pillar_benchmarks.length).toBeGreaterThan(0);
        expect(result.top_gaps).toBeDefined();
      }
    });

    it("includes category and pillar benchmarks", () => {
      const records = makeBenchmarkRecords(55);
      const result = computeOverallBenchmark(records, makeStats(55), config);
      if (!("insufficient_data" in result)) {
        const catNames = result.category_benchmarks.map((c) => c.category);
        expect(catNames).toContain("api_description");
        expect(catNames).toContain("authentication");
        const pillarNames = result.pillar_benchmarks.map((p) => p.pillar);
        expect(pillarNames).toContain("discovery");
        expect(pillarNames).toContain("understandability");
      }
    });
  });

  describe("computeCategoryBenchmark", () => {
    it("returns insufficient_data when below threshold", () => {
      const records = makeBenchmarkRecords(3);
      const result = computeCategoryBenchmark(records, "api_description", { minSampleSize: 50 });
      expect("insufficient_data" in result).toBe(true);
    });

    it("computes percentiles, mean, median, stddev", () => {
      const records = makeBenchmarkRecords(55);
      const result = computeCategoryBenchmark(records, "api_description", config);
      expect("insufficient_data" in result).toBe(false);
      if (!("insufficient_data" in result)) {
        expect(result.category).toBe("api_description");
        expect(result.sample_count).toBe(55);
        expect(result.percentiles.p25).toBeGreaterThanOrEqual(0);
        expect(result.percentiles.p90).toBeLessThanOrEqual(100);
        expect(result.mean).toBeGreaterThan(0);
        expect(result.median).toBeGreaterThan(0);
        expect(result.stddev).toBeGreaterThanOrEqual(0);
      }
    });

    it("filters common gaps to category-specific gaps", () => {
      const records = makeBenchmarkRecords(55);
      const result = computeCategoryBenchmark(records, "api_description", config);
      if (!("insufficient_data" in result)) {
        // All common gaps should contain "api_description" in gap_id
        for (const gap of result.common_gaps) {
          expect(gap.gap_id).toContain(":api_description:");
        }
      }
    });

    it("returns empty common_gaps for category with no matching gaps", () => {
      const records = makeBenchmarkRecords(55);
      const result = computeCategoryBenchmark(records, "authentication", config);
      if (!("insufficient_data" in result)) {
        // authentication has no gap_ids matching ":authentication:"
        expect(result.common_gaps).toEqual([]);
      }
    });
  });

  describe("computePillarBenchmark", () => {
    it("returns insufficient_data when below threshold", () => {
      const records = makeBenchmarkRecords(3);
      const result = computePillarBenchmark(records, "discovery", { minSampleSize: 50 });
      expect("insufficient_data" in result).toBe(true);
    });

    it("computes percentiles and stats for pillar", () => {
      const records = makeBenchmarkRecords(55);
      const result = computePillarBenchmark(records, "discovery", config);
      expect("insufficient_data" in result).toBe(false);
      if (!("insufficient_data" in result)) {
        expect(result.pillar).toBe("discovery");
        expect(result.sample_count).toBe(55);
        expect(result.percentiles.p50).toBeGreaterThan(0);
        expect(result.mean).toBeGreaterThan(0);
        expect(result.median).toBeGreaterThan(0);
      }
    });

    it("returns insufficient_data for non-existent pillar", () => {
      const records = makeBenchmarkRecords(55);
      const result = computePillarBenchmark(records, "nonexistent", config);
      expect("insufficient_data" in result).toBe(true);
    });
  });
});
