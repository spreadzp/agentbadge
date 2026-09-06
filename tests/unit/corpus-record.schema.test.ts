/**
 * SLICE-103-1: Corpus record schema validation tests.
 */

import { describe, it, expect } from "vitest";
import {
  corpusRecordSchema,
  scanSummarySchema,
  gapPatternSchema,
  parseCorpusRecord,
} from "../../src/agent-readiness/corpus/corpus-record.schema";
import {
  categoryBenchmarkSchema,
  overallBenchmarkSchema,
  pillarBenchmarkSchema,
} from "../../src/agent-readiness/corpus/benchmark.schema";

// ── Valid record fixture ─────────────────────────────────────

const validScanSummary = {
  score: 72,
  grade: "B",
  total_rules: 15,
  applicable_rules: 14,
  status_counts: {
    VERIFIED: 10,
    INFERRED: 2,
    GAP: 1,
    CONFLICT: 0,
    NOT_APPLICABLE: 1,
  },
  pillar_scores: { documentation: 80, semantic: 65, runtime: 70 },
};

const validGapPattern = {
  gap_ids: ["gap:documentation:api_description"],
  gap_types: { documentation: 1 },
  gap_priorities: { CRITICAL: 0, HIGH: 0, MEDIUM: 1, LOW: 0 },
};

const validRecord = {
  record_id: "01JAR5X7M2K3N4P5Q6R7S8T9V0",
  timestamp: "2025-09-06T12:00:00Z",
  ruleset_version: "agent-readiness@1.2.0",
  schema_version: "0.11.0",
  scan_summary: validScanSummary,
  category_scores: { api_description: 85, authentication: 60, metadata: 90 },
  gap_pattern: validGapPattern,
  conflict_rules: [],
  industry_vertical: "fintech",
  has_runtime_trace: false,
};

describe("SLICE-103-1: corpus-record.schema", () => {
  describe("scanSummarySchema", () => {
    it("validates a correct scan summary", () => {
      expect(scanSummarySchema.parse(validScanSummary)).toEqual(validScanSummary);
    });

    it("rejects score > 100", () => {
      expect(() => scanSummarySchema.parse({ ...validScanSummary, score: 101 })).toThrow();
    });

    it("rejects score < 0", () => {
      expect(() => scanSummarySchema.parse({ ...validScanSummary, score: -1 })).toThrow();
    });

    it("rejects invalid grade", () => {
      expect(() => scanSummarySchema.parse({ ...validScanSummary, grade: "X" })).toThrow();
    });

    it("accepts missing pillar_scores (optional)", () => {
      const { pillar_scores: _, ...withoutPillar } = validScanSummary;
      expect(scanSummarySchema.parse(withoutPillar)).toBeDefined();
    });
  });

  describe("gapPatternSchema", () => {
    it("validates a correct gap pattern", () => {
      expect(gapPatternSchema.parse(validGapPattern)).toEqual(validGapPattern);
    });

    it("rejects missing gap_priorities", () => {
      expect(() => gapPatternSchema.parse({ gap_ids: [], gap_types: {} })).toThrow();
    });
  });

  describe("corpusRecordSchema", () => {
    it("validates a correct record", () => {
      const result = corpusRecordSchema.parse(validRecord);
      expect(result.record_id).toBe(validRecord.record_id);
      expect(result.scan_summary.score).toBe(72);
    });

    it("rejects invalid ULID", () => {
      expect(() =>
        corpusRecordSchema.parse({ ...validRecord, record_id: "short" }),
      ).toThrow();
    });

    it("rejects non-ISO timestamp", () => {
      expect(() =>
        corpusRecordSchema.parse({ ...validRecord, timestamp: "not-a-date" }),
      ).toThrow();
    });

    it("rejects missing required field", () => {
      expect(() => {
        const { has_runtime_trace: _, ...rest } = validRecord;
        corpusRecordSchema.parse(rest);
      }).toThrow();
    });

    it("accepts optional fields as null", () => {
      const record = {
        ...validRecord,
        asr: null,
        profile_ref: null,
        snapshot_ref: null,
      };
      expect(corpusRecordSchema.parse(record)).toBeDefined();
    });

    it("accepts record without optional fields", () => {
      const record = {
        record_id: "01JAR5X7M2K3N4P5Q6R7S8T9V0",
        timestamp: "2025-09-06T12:00:00Z",
        ruleset_version: "agent-readiness@1.2.0",
        schema_version: "0.11.0",
        scan_summary: validScanSummary,
        category_scores: { api_description: 85 },
        gap_pattern: validGapPattern,
        conflict_rules: [],
        has_runtime_trace: false,
      };
      expect(corpusRecordSchema.parse(record)).toBeDefined();
    });

    it("rejects category_scores > 100", () => {
      expect(() =>
        corpusRecordSchema.parse({
          ...validRecord,
          category_scores: { api: 101 },
        }),
      ).toThrow();
    });

    it("parseCorpusRecord returns typed record", () => {
      const result = parseCorpusRecord(validRecord);
      expect(result.scan_summary.grade).toBe("B");
    });
  });
});

describe("SLICE-103-1: benchmark.schema", () => {
  const validCategoryBenchmark = {
    category: "api_description",
    sample_count: 100,
    percentiles: { p25: 50, p50: 65, p75: 80, p90: 92 },
    mean: 67.5,
    median: 65,
    stddev: 15.2,
    common_gaps: [{ gap_id: "gap:documentation:api_description", frequency: 30, pct: 0.3 }],
  };

  const validOverallBenchmark = {
    corpus_stats: {
      total_records: 500,
      date_range: { earliest: "2025-01-01", latest: "2025-09-06" },
      ruleset_versions: ["agent-readiness@1.2.0"],
      verticals: ["fintech", "healthcare"],
    },
    score_histogram: { "70-79": 120, "80-89": 200 },
    category_benchmarks: [validCategoryBenchmark],
    pillar_benchmarks: [
      {
        pillar: "documentation",
        sample_count: 500,
        percentiles: { p25: 55, p50: 70, p75: 85, p90: 93 },
        mean: 68,
        median: 70,
      },
    ],
    top_gaps: [{ gap_id: "gap:documentation:api_description", frequency: 150, pct: 0.3 }],
  };

  it("validates a correct category benchmark", () => {
    expect(categoryBenchmarkSchema.parse(validCategoryBenchmark)).toEqual(validCategoryBenchmark);
  });

  it("validates a correct pillar benchmark", () => {
    const pillar = {
      pillar: "documentation",
      sample_count: 500,
      percentiles: { p25: 55, p50: 70, p75: 85, p90: 93 },
      mean: 68,
      median: 70,
    };
    expect(pillarBenchmarkSchema.parse(pillar)).toEqual(pillar);
  });

  it("validates a correct overall benchmark", () => {
    expect(overallBenchmarkSchema.parse(validOverallBenchmark)).toEqual(validOverallBenchmark);
  });

  it("rejects category benchmark with non-integer sample_count", () => {
    expect(() =>
      categoryBenchmarkSchema.parse({ ...validCategoryBenchmark, sample_count: 1.5 }),
    ).toThrow();
  });

  it("rejects overall benchmark missing top_gaps", () => {
    expect(() => {
      const { top_gaps: _, ...rest } = validOverallBenchmark;
      overallBenchmarkSchema.parse(rest);
    }).toThrow();
  });
});
