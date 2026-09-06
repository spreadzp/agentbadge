/**
 * SLICE-103-3: Aggregation engine — cross-scan statistics.
 *
 * All functions are pure: input CorpusRecord[] → output aggregates.
 * Deterministic: same input → same output.
 */

import type { CorpusRecord } from "./corpus-record.schema";
import { mean, median, stddev, percentile, bucketize } from "./stats-utils";

// ── Types ────────────────────────────────────────────────────

export interface GapFrequency {
  gap_id: string;
  frequency: number;
  pct: number;
}

export interface ScoreHistogram {
  buckets: Record<string, number>;
  total: number;
}

export interface CategoryDistribution {
  category: string;
  scores: number[];
  count: number;
  mean: number;
  median: number;
  stddev: number;
  percentiles: { p25: number; p50: number; p75: number; p90: number };
}

export interface PillarDistribution {
  pillar: string;
  scores: number[];
  count: number;
  mean: number;
  median: number;
  percentiles: { p25: number; p50: number; p75: number; p90: number };
}

export interface StatusDistribution {
  VERIFIED: number;
  INFERRED: number;
  GAP: number;
  CONFLICT: number;
  NOT_APPLICABLE: number;
  total: number;
}

export interface GapTypeDistribution {
  [gapType: string]: number;
}

export interface ConflictFrequency {
  rule_id: string;
  frequency: number;
  pct: number;
}

export interface TrendPoint {
  date: string;
  mean_score: number;
  median_score: number;
  record_count: number;
  top_gap_id: string;
}

export interface VerticalComparison {
  vertical: string;
  record_count: number;
  mean_score: number;
  median_score: number;
  top_gaps: GapFrequency[];
}

// ── Aggregation functions ────────────────────────────────────

export function computeGapFrequency(records: CorpusRecord[]): GapFrequency[] {
  if (records.length === 0) return [];
  const total = records.length;
  const counts = new Map<string, number>();

  for (const r of records) {
    for (const gapId of r.gap_pattern.gap_ids) {
      counts.set(gapId, (counts.get(gapId) ?? 0) + 1);
    }
  }

  return [...counts.entries()]
    .map(([gap_id, frequency]) => ({
      gap_id,
      frequency,
      pct: (frequency / total) * 100,
    }))
    .sort((a, b) => b.frequency - a.frequency);
}

export function computeScoreHistogram(records: CorpusRecord[]): ScoreHistogram {
  const buckets: Record<string, number> = {};
  // Initialize all buckets
  for (let start = 0; start < 100; start += 10) {
    buckets[`${start}-${start + 10}`] = 0;
  }
  buckets["90-100"] = 0;

  for (const r of records) {
    const bucket = bucketize(r.scan_summary.score, 10, 0, 100);
    buckets[bucket] = (buckets[bucket] ?? 0) + 1;
  }

  return { buckets, total: records.length };
}

export function computeCategoryDistribution(records: CorpusRecord[]): CategoryDistribution[] {
  const categoryScores = new Map<string, number[]>();

  for (const r of records) {
    for (const [category, score] of Object.entries(r.category_scores)) {
      if (!categoryScores.has(category)) categoryScores.set(category, []);
      categoryScores.get(category)!.push(score);
    }
  }

  return [...categoryScores.entries()].map(([category, scores]) => ({
    category,
    scores,
    count: scores.length,
    mean: mean(scores),
    median: median(scores),
    stddev: stddev(scores),
    percentiles: {
      p25: percentile(scores, 25),
      p50: percentile(scores, 50),
      p75: percentile(scores, 75),
      p90: percentile(scores, 90),
    },
  }));
}

export function computePillarDistribution(records: CorpusRecord[]): PillarDistribution[] {
  const pillarScores = new Map<string, number[]>();

  for (const r of records) {
    const pillars = r.scan_summary.pillar_scores;
    if (!pillars) continue;
    for (const [pillar, score] of Object.entries(pillars)) {
      if (!pillarScores.has(pillar)) pillarScores.set(pillar, []);
      pillarScores.get(pillar)!.push(score);
    }
  }

  return [...pillarScores.entries()].map(([pillar, scores]) => ({
    pillar,
    scores,
    count: scores.length,
    mean: mean(scores),
    median: median(scores),
    percentiles: {
      p25: percentile(scores, 25),
      p50: percentile(scores, 50),
      p75: percentile(scores, 75),
      p90: percentile(scores, 90),
    },
  }));
}

export function computeStatusDistribution(records: CorpusRecord[]): StatusDistribution {
  const dist: StatusDistribution = {
    VERIFIED: 0,
    INFERRED: 0,
    GAP: 0,
    CONFLICT: 0,
    NOT_APPLICABLE: 0,
    total: records.length,
  };

  for (const r of records) {
    const sc = r.scan_summary.status_counts;
    dist.VERIFIED += sc.VERIFIED;
    dist.INFERRED += sc.INFERRED;
    dist.GAP += sc.GAP;
    dist.CONFLICT += sc.CONFLICT;
    dist.NOT_APPLICABLE += sc.NOT_APPLICABLE;
  }

  return dist;
}

export function computeGapTypeDistribution(records: CorpusRecord[]): GapTypeDistribution {
  const dist: GapTypeDistribution = {};

  for (const r of records) {
    for (const [type, count] of Object.entries(r.gap_pattern.gap_types)) {
      dist[type] = (dist[type] ?? 0) + count;
    }
  }

  return dist;
}

export function computeConflictFrequency(records: CorpusRecord[]): ConflictFrequency[] {
  if (records.length === 0) return [];
  const total = records.length;
  const counts = new Map<string, number>();

  for (const r of records) {
    for (const ruleId of r.conflict_rules) {
      counts.set(ruleId, (counts.get(ruleId) ?? 0) + 1);
    }
  }

  return [...counts.entries()]
    .map(([rule_id, frequency]) => ({
      rule_id,
      frequency,
      pct: (frequency / total) * 100,
    }))
    .sort((a, b) => b.frequency - a.frequency);
}

export function computeTrend(records: CorpusRecord[], bucket: "week" | "month"): TrendPoint[] {
  if (records.length === 0) return [];

  const groups = new Map<string, CorpusRecord[]>();

  for (const r of records) {
    const date = r.timestamp.slice(0, 10);
    const key = bucket === "month" ? date.slice(0, 7) : getWeekKey(date);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }

  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, recs]) => {
      const scores = recs.map((r) => r.scan_summary.score);
      const gapCounts = new Map<string, number>();
      for (const r of recs) {
        for (const gapId of r.gap_pattern.gap_ids) {
          gapCounts.set(gapId, (gapCounts.get(gapId) ?? 0) + 1);
        }
      }
      const topGap = [...gapCounts.entries()].sort((a, b) => b[1] - a[1])[0];

      return {
        date,
        mean_score: mean(scores),
        median_score: median(scores),
        record_count: recs.length,
        top_gap_id: topGap?.[0] ?? "",
      };
    });
}

export function computeVerticalComparison(records: CorpusRecord[]): VerticalComparison[] {
  const verticals = new Map<string, CorpusRecord[]>();

  for (const r of records) {
    if (!r.industry_vertical) continue;
    if (!verticals.has(r.industry_vertical)) verticals.set(r.industry_vertical, []);
    verticals.get(r.industry_vertical)!.push(r);
  }

  return [...verticals.entries()].map(([vertical, recs]) => {
    const scores = recs.map((r) => r.scan_summary.score);
    return {
      vertical,
      record_count: recs.length,
      mean_score: mean(scores),
      median_score: median(scores),
      top_gaps: computeGapFrequency(recs).slice(0, 5),
    };
  });
}

// ── Helpers ──────────────────────────────────────────────────

/**
 * Get ISO 8601 week key (YYYY-Www) for a date.
 * Weeks start on Monday.
 */
function getWeekKey(dateStr: string): string {
  const date = new Date(dateStr);
  const day = date.getUTCDay();
  const diff = (day === 0 ? 6 : day - 1); // Monday = 0
  const monday = new Date(date);
  monday.setUTCDate(date.getUTCDate() - diff);

  const year = monday.getUTCFullYear();
  const jan1 = new Date(Date.UTC(year, 0, 1));
  const weekNum = Math.ceil(((monday.getTime() - jan1.getTime()) / 86400000 + 1) / 7);

  return `${year}-W${String(weekNum).padStart(2, "0")}`;
}
