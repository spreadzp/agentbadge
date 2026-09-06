/**
 * SLICE-103-3: Aggregation engine tests.
 */

import { describe, it, expect } from "vitest";
import type { CorpusRecord } from "../../src/agent-readiness/corpus/corpus-record.schema";
import {
  computeGapFrequency,
  computeScoreHistogram,
  computeCategoryDistribution,
  computePillarDistribution,
  computeStatusDistribution,
  computeGapTypeDistribution,
  computeConflictFrequency,
  computeTrend,
  computeVerticalComparison,
} from "../../src/agent-readiness/corpus/aggregation-engine";

// ── Fixture records ──────────────────────────────────────────

function makeRecord(overrides: Partial<CorpusRecord> = {}): CorpusRecord {
  return {
    record_id: "01JAR5X7M2K3N4P5Q6R7S8T9V0",
    timestamp: "2025-01-15T12:00:00Z",
    ruleset_version: "agent-readiness@1.2.0",
    schema_version: "0.11.0",
    scan_summary: {
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
      pillar_scores: { discovery: 80, understandability: 65 },
    },
    category_scores: { api_description: 85, authentication: 60 },
    gap_pattern: {
      gap_ids: ["gap:documentation:api_description"],
      gap_types: { documentation: 1 },
      gap_priorities: { CRITICAL: 0, HIGH: 0, MEDIUM: 1, LOW: 0 },
    },
    conflict_rules: [],
    industry_vertical: "fintech",
    has_runtime_trace: false,
    ...overrides,
  };
}

const records: CorpusRecord[] = [
  makeRecord({
    record_id: "01JAR5X7M2K3N4P5Q6R7S8T9V1",
    timestamp: "2025-01-15T12:00:00Z",
    scan_summary: { ...makeRecord().scan_summary, score: 72 },
    industry_vertical: "fintech",
  }),
  makeRecord({
    record_id: "01JAR5X7M2K3N4P5Q6R7S8T9V2",
    timestamp: "2025-02-20T12:00:00Z",
    scan_summary: { ...makeRecord().scan_summary, score: 85 },
    gap_pattern: {
      gap_ids: ["gap:documentation:llms_txt", "gap:semantic:openapi"],
      gap_types: { documentation: 1, semantic: 1 },
      gap_priorities: { CRITICAL: 0, HIGH: 1, MEDIUM: 1, LOW: 0 },
    },
    industry_vertical: "healthcare",
  }),
  makeRecord({
    record_id: "01JAR5X7M2K3N4P5Q6R7S8T9V3",
    timestamp: "2025-01-22T12:00:00Z",
    scan_summary: { ...makeRecord().scan_summary, score: 45 },
    conflict_rules: ["AB-001"],
    industry_vertical: "fintech",
  }),
];

describe("SLICE-103-3: aggregation-engine", () => {
  describe("computeGapFrequency", () => {
    it("counts gap_ids across records and sorts by frequency", () => {
      const result = computeGapFrequency(records);
      expect(result).toHaveLength(3);
      expect(result[0].gap_id).toBe("gap:documentation:api_description");
      expect(result[0].frequency).toBe(2); // in record 1 and 3
      expect(result[0].pct).toBeCloseTo(66.67, 1);
    });

    it("returns empty array for no records", () => {
      expect(computeGapFrequency([])).toEqual([]);
    });
  });

  describe("computeScoreHistogram", () => {
    it("buckets scores into 10-point ranges", () => {
      const result = computeScoreHistogram(records);
      expect(result.total).toBe(3);
      expect(result.buckets["40-50"]).toBe(1); // score 45
      expect(result.buckets["70-80"]).toBe(1); // score 72
      expect(result.buckets["80-90"]).toBe(1); // score 85
    });

    it("initializes all buckets", () => {
      const result = computeScoreHistogram([]);
      expect(result.total).toBe(0);
      expect(result.buckets["0-10"]).toBe(0);
      expect(result.buckets["90-100"]).toBe(0);
    });
  });

  describe("computeCategoryDistribution", () => {
    it("computes statistics per category", () => {
      const result = computeCategoryDistribution(records);
      const api = result.find((c) => c.category === "api_description");
      expect(api).toBeDefined();
      expect(api!.count).toBe(3);
      expect(api!.mean).toBeCloseTo(85, 0);
    });

    it("returns empty for no records", () => {
      expect(computeCategoryDistribution([])).toEqual([]);
    });
  });

  describe("computePillarDistribution", () => {
    it("computes statistics per pillar", () => {
      const result = computePillarDistribution(records);
      const discovery = result.find((p) => p.pillar === "discovery");
      expect(discovery).toBeDefined();
      expect(discovery!.count).toBe(3);
      expect(discovery!.mean).toBe(80);
    });

    it("returns empty for no records", () => {
      expect(computePillarDistribution([])).toEqual([]);
    });
  });

  describe("computeStatusDistribution", () => {
    it("sums status counts across records", () => {
      const result = computeStatusDistribution(records);
      expect(result.VERIFIED).toBe(30); // 10 * 3
      expect(result.GAP).toBe(3); // 1 * 3
      expect(result.total).toBe(3);
    });

    it("returns zeros for no records", () => {
      const result = computeStatusDistribution([]);
      expect(result.VERIFIED).toBe(0);
      expect(result.total).toBe(0);
    });
  });

  describe("computeGapTypeDistribution", () => {
    it("sums gap types across records", () => {
      const result = computeGapTypeDistribution(records);
      expect(result.documentation).toBe(3); // 1+1+1
      expect(result.semantic).toBe(1); // only in record 2
    });

    it("returns empty object for no records", () => {
      expect(computeGapTypeDistribution([])).toEqual({});
    });
  });

  describe("computeConflictFrequency", () => {
    it("counts conflicting rule_ids", () => {
      const result = computeConflictFrequency(records);
      expect(result).toHaveLength(1);
      expect(result[0].rule_id).toBe("AB-001");
      expect(result[0].frequency).toBe(1);
      expect(result[0].pct).toBeCloseTo(33.33, 1);
    });

    it("returns empty for no records", () => {
      expect(computeConflictFrequency([])).toEqual([]);
    });
  });

  describe("computeTrend", () => {
    it("groups by month with correct stats", () => {
      const result = computeTrend(records, "month");
      expect(result).toHaveLength(2); // Jan and Feb
      const jan = result.find((t) => t.date === "2025-01");
      expect(jan).toBeDefined();
      expect(jan!.record_count).toBe(2);
      expect(jan!.mean_score).toBeCloseTo(58.5, 1); // (72+45)/2
    });

    it("groups by week", () => {
      const result = computeTrend(records, "week");
      expect(result.length).toBeGreaterThanOrEqual(2);
    });

    it("returns empty for no records", () => {
      expect(computeTrend([], "month")).toEqual([]);
    });
  });

  describe("computeVerticalComparison", () => {
    it("groups by vertical with top gaps", () => {
      const result = computeVerticalComparison(records);
      expect(result).toHaveLength(2); // fintech + healthcare

      const fintech = result.find((v) => v.vertical === "fintech");
      expect(fintech).toBeDefined();
      expect(fintech!.record_count).toBe(2);
      expect(fintech!.mean_score).toBeCloseTo(58.5, 1); // (72+45)/2
      expect(fintech!.top_gaps.length).toBeLessThanOrEqual(5);
    });

    it("excludes records without vertical", () => {
      const noVertical = [makeRecord({ industry_vertical: undefined })];
      expect(computeVerticalComparison(noVertical)).toEqual([]);
    });

    it("returns empty for no records", () => {
      expect(computeVerticalComparison([])).toEqual([]);
    });
  });
});
