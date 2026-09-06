/**
 * SLICE-103-4: Trend analysis tests.
 */

import { describe, it, expect } from "vitest";
import type { CorpusRecord } from "../../src/agent-readiness/corpus/corpus-record.schema";
import { analyzeTrend } from "../../src/agent-readiness/corpus/trend-analysis";

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
      pillar_scores: { discovery: 75 },
    },
    category_scores: { api_description: 80 },
    gap_pattern: {
      gap_ids: ["gap:documentation:llms_txt"],
      gap_types: { documentation: 1 },
      gap_priorities: { CRITICAL: 0, HIGH: 0, MEDIUM: 1, LOW: 0 },
    },
    conflict_rules: [],
    industry_vertical: "fintech",
    has_runtime_trace: false,
    ...overrides,
  };
}

describe("SLICE-103-4: trend-analysis", () => {
  it("analyzes trend with improving direction", () => {
    const records: CorpusRecord[] = [
      makeRecord({ timestamp: "2025-01-06T12:00:00Z", scan_summary: { ...makeRecord().scan_summary, score: 50 } }),
      makeRecord({ timestamp: "2025-01-13T12:00:00Z", scan_summary: { ...makeRecord().scan_summary, score: 55 } }),
      makeRecord({ timestamp: "2025-01-20T12:00:00Z", scan_summary: { ...makeRecord().scan_summary, score: 60 } }),
      makeRecord({ timestamp: "2025-01-27T12:00:00Z", scan_summary: { ...makeRecord().scan_summary, score: 65 } }),
    ];

    const result = analyzeTrend(records, "all");
    expect(result.direction).toBe("improving");
    expect(result.score_delta).toBeGreaterThan(2);
    expect(result.buckets.length).toBeGreaterThanOrEqual(2);
  });

  it("analyzes trend with declining direction", () => {
    const records: CorpusRecord[] = [
      makeRecord({ timestamp: "2025-01-06T12:00:00Z", scan_summary: { ...makeRecord().scan_summary, score: 80 } }),
      makeRecord({ timestamp: "2025-01-13T12:00:00Z", scan_summary: { ...makeRecord().scan_summary, score: 75 } }),
      makeRecord({ timestamp: "2025-01-20T12:00:00Z", scan_summary: { ...makeRecord().scan_summary, score: 70 } }),
      makeRecord({ timestamp: "2025-01-27T12:00:00Z", scan_summary: { ...makeRecord().scan_summary, score: 65 } }),
    ];

    const result = analyzeTrend(records, "all");
    expect(result.direction).toBe("declining");
    expect(result.score_delta).toBeLessThan(-2);
  });

  it("analyzes trend with stable direction", () => {
    const records: CorpusRecord[] = [
      makeRecord({ timestamp: "2025-01-06T12:00:00Z", scan_summary: { ...makeRecord().scan_summary, score: 70 } }),
      makeRecord({ timestamp: "2025-01-13T12:00:00Z", scan_summary: { ...makeRecord().scan_summary, score: 71 } }),
      makeRecord({ timestamp: "2025-01-20T12:00:00Z", scan_summary: { ...makeRecord().scan_summary, score: 70 } }),
      makeRecord({ timestamp: "2025-01-27T12:00:00Z", scan_summary: { ...makeRecord().scan_summary, score: 71 } }),
    ];

    const result = analyzeTrend(records, "all");
    expect(result.direction).toBe("stable");
  });

  it("computes gap trends", () => {
    const records: CorpusRecord[] = [
      makeRecord({ timestamp: "2025-01-06T12:00:00Z", gap_pattern: { gap_ids: ["gap:documentation:llms_txt"], gap_types: { documentation: 1 }, gap_priorities: { CRITICAL: 0, HIGH: 0, MEDIUM: 1, LOW: 0 } } }),
      makeRecord({ timestamp: "2025-01-13T12:00:00Z", gap_pattern: { gap_ids: ["gap:documentation:llms_txt"], gap_types: { documentation: 1 }, gap_priorities: { CRITICAL: 0, HIGH: 0, MEDIUM: 1, LOW: 0 } } }),
      makeRecord({ timestamp: "2025-01-20T12:00:00Z", gap_pattern: { gap_ids: [], gap_types: {}, gap_priorities: { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 } } }),
      makeRecord({ timestamp: "2025-01-27T12:00:00Z", gap_pattern: { gap_ids: [], gap_types: {}, gap_priorities: { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 } } }),
    ];

    const result = analyzeTrend(records, "all");
    const llmsGap = result.gap_trend.find((g) => g.gap_id === "gap:documentation:llms_txt");
    expect(llmsGap).toBeDefined();
    expect(llmsGap!.direction).toBe("decreasing");
  });

  it("returns empty buckets for no records", () => {
    const result = analyzeTrend([], "all");
    expect(result.buckets).toEqual([]);
    expect(result.direction).toBe("stable");
  });

  it("filters to 30d period", () => {
    const now = new Date();
    const oldDate = new Date(now.getTime() - 60 * 86400000).toISOString();
    const recentDate = new Date(now.getTime() - 5 * 86400000).toISOString();

    const records: CorpusRecord[] = [
      makeRecord({ timestamp: oldDate, scan_summary: { ...makeRecord().scan_summary, score: 30 } }),
      makeRecord({ timestamp: recentDate, scan_summary: { ...makeRecord().scan_summary, score: 80 } }),
    ];

    const result30d = analyzeTrend(records, "30d");
    // Old record should be filtered out
    expect(result30d.buckets.length).toBeLessThanOrEqual(1);
  });
});
