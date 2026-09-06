/**
 * SLICE-103-4: Benchmark cache tests.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { InMemoryBenchmarkCache } from "../../src/agent-readiness/corpus/benchmark-cache";
import type { OverallBenchmark, CategoryBenchmark } from "../../src/agent-readiness/corpus/benchmark.schema";

function makeOverallBenchmark(): OverallBenchmark {
  return {
    corpus_stats: {
      total_records: 100,
      date_range: { earliest: "2025-01-01T00:00:00Z", latest: "2025-06-01T00:00:00Z" },
      ruleset_versions: ["agent-readiness@1.2.0"],
      verticals: ["fintech"],
    },
    score_histogram: { "70-80": 50, "80-90": 50 },
    category_benchmarks: [],
    pillar_benchmarks: [],
    top_gaps: [],
  };
}

function makeCategoryBenchmark(): CategoryBenchmark {
  return {
    category: "api_description",
    sample_count: 100,
    percentiles: { p25: 60, p50: 70, p75: 80, p90: 90 },
    mean: 72,
    median: 70,
    stddev: 10,
    common_gaps: [],
  };
}

describe("SLICE-103-4: InMemoryBenchmarkCache", () => {
  let cache: InMemoryBenchmarkCache;

  beforeEach(() => {
    cache = new InMemoryBenchmarkCache();
  });

  it("stores and retrieves overall benchmark", () => {
    const bench = makeOverallBenchmark();
    cache.setOverall(bench, 3600);
    expect(cache.getOverall()).toEqual(bench);
  });

  it("stores and retrieves category benchmark", () => {
    const bench = makeCategoryBenchmark();
    cache.setCategory("api_description", bench, 3600);
    expect(cache.getCategory("api_description")).toEqual(bench);
  });

  it("returns null for missing entries", () => {
    expect(cache.getOverall()).toBeNull();
    expect(cache.getCategory("nonexistent")).toBeNull();
  });

  it("respects TTL — entry expires after configured seconds", () => {
    vi.useFakeTimers();

    const bench = makeOverallBenchmark();
    cache.setOverall(bench, 1); // 1 second TTL

    // Immediately available
    expect(cache.getOverall()).toEqual(bench);

    // Advance 2 seconds — should be expired
    vi.advanceTimersByTime(2000);
    expect(cache.getOverall()).toBeNull();

    vi.useRealTimers();
  });

  it("isExpired returns true for non-existent keys", () => {
    expect(cache.isExpired("nonexistent")).toBe(true);
  });

  it("isExpired returns false for fresh entries", () => {
    cache.setOverall(makeOverallBenchmark(), 3600);
    expect(cache.isExpired("__overall__")).toBe(false);
  });

  it("invalidate clears all entries", () => {
    cache.setOverall(makeOverallBenchmark(), 3600);
    cache.setCategory("api_description", makeCategoryBenchmark(), 3600);

    cache.invalidate();

    expect(cache.getOverall()).toBeNull();
    expect(cache.getCategory("api_description")).toBeNull();
  });
});
