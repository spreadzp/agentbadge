/**
 * SLICE-103-1: Benchmark schemas (spec v0.11 §14.4–14.5).
 *
 * Category and overall benchmark shapes for the benchmark API.
 */

import { z } from "zod";

// ── Category benchmark ───────────────────────────────────────

export const categoryBenchmarkSchema = z.object({
  category: z.string(),
  sample_count: z.number().int(),
  percentiles: z.object({
    p25: z.number(),
    p50: z.number(),
    p75: z.number(),
    p90: z.number(),
  }),
  mean: z.number(),
  median: z.number(),
  stddev: z.number(),
  common_gaps: z.array(
    z.object({
      gap_id: z.string(),
      frequency: z.number().int(),
      pct: z.number(),
    }),
  ),
});

// ── Pillar benchmark ─────────────────────────────────────────

export const pillarBenchmarkSchema = z.object({
  pillar: z.string(),
  sample_count: z.number().int(),
  percentiles: z.object({
    p25: z.number(),
    p50: z.number(),
    p75: z.number(),
    p90: z.number(),
  }),
  mean: z.number(),
  median: z.number(),
});

// ── Overall benchmark ────────────────────────────────────────

export const overallBenchmarkSchema = z.object({
  corpus_stats: z.object({
    total_records: z.number().int(),
    date_range: z.object({
      earliest: z.string(),
      latest: z.string(),
    }),
    ruleset_versions: z.array(z.string()),
    verticals: z.array(z.string()),
  }),
  score_histogram: z.record(z.string(), z.number().int()),
  category_benchmarks: z.array(categoryBenchmarkSchema),
  pillar_benchmarks: z.array(pillarBenchmarkSchema),
  top_gaps: z.array(
    z.object({
      gap_id: z.string(),
      frequency: z.number().int(),
      pct: z.number(),
    }),
  ),
});

// ── Types ────────────────────────────────────────────────────

export type CategoryBenchmark = z.infer<typeof categoryBenchmarkSchema>;
export type PillarBenchmark = z.infer<typeof pillarBenchmarkSchema>;
export type OverallBenchmark = z.infer<typeof overallBenchmarkSchema>;
