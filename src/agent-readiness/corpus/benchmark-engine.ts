/**
 * SLICE-103-4: Benchmark computation engine.
 *
 * Uses aggregation engine functions — no duplicated logic.
 * Pure functions (except config threshold check).
 */

import type { CorpusRecord } from "./corpus-record.schema";
import type { CategoryBenchmark, OverallBenchmark, PillarBenchmark } from "./benchmark.schema";
import type { CorpusStats } from "./corpus-store";
import { mean, median, stddev, percentile } from "./stats-utils";
import { computeScoreHistogram, computeGapFrequency } from "./aggregation-engine";

export interface BenchmarkConfig {
  minSampleSize: number;
}

export const DEFAULT_BENCHMARK_CONFIG: BenchmarkConfig = { minSampleSize: 50 };

export interface InsufficientData {
  insufficient_data: true;
  sample_count: number;
}

export function computeOverallBenchmark(
  records: CorpusRecord[],
  stats: CorpusStats,
  config: BenchmarkConfig = DEFAULT_BENCHMARK_CONFIG,
): OverallBenchmark | InsufficientData {
  if (records.length < config.minSampleSize) {
    return { insufficient_data: true, sample_count: records.length };
  }

  const histogram = computeScoreHistogram(records);
  const categoryBenchmarks: CategoryBenchmark[] = [];
  const pillarBenchmarks: PillarBenchmark[] = [];

  // Collect all categories
  const categories = new Set<string>();
  const pillars = new Set<string>();

  for (const r of records) {
    for (const cat of Object.keys(r.category_scores)) categories.add(cat);
    const ps = r.scan_summary.pillar_scores;
    if (ps) for (const p of Object.keys(ps)) pillars.add(p);
  }

  for (const category of categories) {
    const bench = computeCategoryBenchmark(records, category, config);
    if (!("insufficient_data" in bench)) categoryBenchmarks.push(bench);
  }

  for (const pillar of pillars) {
    const bench = computePillarBenchmark(records, pillar, config);
    if (!("insufficient_data" in bench)) pillarBenchmarks.push(bench);
  }

  const topGaps = computeGapFrequency(records).slice(0, 10);

  return {
    corpus_stats: {
      total_records: stats.total_records,
      date_range: stats.date_range,
      ruleset_versions: stats.ruleset_versions,
      verticals: stats.verticals,
    },
    score_histogram: histogram.buckets,
    category_benchmarks: categoryBenchmarks,
    pillar_benchmarks: pillarBenchmarks,
    top_gaps: topGaps,
  };
}

export function computeCategoryBenchmark(
  records: CorpusRecord[],
  category: string,
  config: BenchmarkConfig = DEFAULT_BENCHMARK_CONFIG,
): CategoryBenchmark | InsufficientData {
  const scores: number[] = [];
  const categoryRecords: CorpusRecord[] = [];

  for (const r of records) {
    if (category in r.category_scores) {
      scores.push(r.category_scores[category]);
      categoryRecords.push(r);
    }
  }

  if (scores.length < config.minSampleSize) {
    return { insufficient_data: true, sample_count: scores.length };
  }

  // Common gaps: filter gap_ids that contain the category name
  const gapCounts = new Map<string, number>();
  for (const r of categoryRecords) {
    for (const gapId of r.gap_pattern.gap_ids) {
      if (gapId.includes(`:${category}:`)) {
        gapCounts.set(gapId, (gapCounts.get(gapId) ?? 0) + 1);
      }
    }
  }

  const commonGaps = [...gapCounts.entries()]
    .map(([gap_id, frequency]) => ({
      gap_id,
      frequency,
      pct: (frequency / scores.length) * 100,
    }))
    .sort((a, b) => b.frequency - a.frequency)
    .slice(0, 10);

  return {
    category,
    sample_count: scores.length,
    percentiles: {
      p25: percentile(scores, 25),
      p50: percentile(scores, 50),
      p75: percentile(scores, 75),
      p90: percentile(scores, 90),
    },
    mean: mean(scores),
    median: median(scores),
    stddev: stddev(scores),
    common_gaps: commonGaps,
  };
}

export function computePillarBenchmark(
  records: CorpusRecord[],
  pillar: string,
  config: BenchmarkConfig = DEFAULT_BENCHMARK_CONFIG,
): PillarBenchmark | InsufficientData {
  const scores: number[] = [];

  for (const r of records) {
    const ps = r.scan_summary.pillar_scores;
    if (ps && pillar in ps) {
      scores.push(ps[pillar]);
    }
  }

  if (scores.length < config.minSampleSize) {
    return { insufficient_data: true, sample_count: scores.length };
  }

  return {
    pillar,
    sample_count: scores.length,
    percentiles: {
      p25: percentile(scores, 25),
      p50: percentile(scores, 50),
      p75: percentile(scores, 75),
      p90: percentile(scores, 90),
    },
    mean: mean(scores),
    median: median(scores),
  };
}
