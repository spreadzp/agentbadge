/**
 * SLICE-103-4: Trend analysis with direction detection.
 *
 * Uses aggregation engine's computeTrend for bucketing.
 * Pure function.
 */

import type { CorpusRecord } from "./corpus-record.schema";
import { computeTrend, type TrendPoint } from "./aggregation-engine";

export interface TrendBucket {
  date: string;
  mean_score: number;
  median_score: number;
  record_count: number;
  top_gap_id: string;
}

export interface GapTrend {
  gap_id: string;
  direction: "increasing" | "decreasing" | "stable";
  delta: number;
}

export interface TrendAnalysis {
  period: "30d" | "90d" | "all";
  buckets: TrendBucket[];
  direction: "improving" | "declining" | "stable";
  score_delta: number;
  gap_trend: GapTrend[];
}

export function analyzeTrend(
  records: CorpusRecord[],
  period: "30d" | "90d" | "all",
): TrendAnalysis {
  // 1. Filter records to period
  const now = new Date();
  const filtered = records.filter((r) => {
    if (period === "all") return true;
    const recordDate = new Date(r.timestamp);
    const days = (now.getTime() - recordDate.getTime()) / 86400000;
    return days <= (period === "30d" ? 30 : 90);
  });

  // 2. Bucket by week
  const trendPoints = computeTrend(filtered, "week");
  const buckets: TrendBucket[] = trendPoints.map((t: TrendPoint) => ({
    date: t.date,
    mean_score: t.mean_score,
    median_score: t.median_score,
    record_count: t.record_count,
    top_gap_id: t.top_gap_id,
  }));

  // 3. Determine direction (compare first vs last bucket)
  let direction: "improving" | "declining" | "stable" = "stable";
  let scoreDelta = 0;
  if (buckets.length >= 2) {
    const first = buckets[0].mean_score;
    const last = buckets[buckets.length - 1].mean_score;
    scoreDelta = last - first;
    if (scoreDelta > 2) direction = "improving";
    else if (scoreDelta < -2) direction = "declining";
  }

  // 4. Compute gap trends (first half vs second half frequency)
  const gapTrend = computeGapTrends(filtered);

  return {
    period,
    buckets,
    direction,
    score_delta: scoreDelta,
    gap_trend: gapTrend,
  };
}

function computeGapTrends(records: CorpusRecord[]): GapTrend[] {
  if (records.length === 0) return [];

  // Split into first and second half by time
  const sorted = [...records].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const midPoint = Math.floor(sorted.length / 2);
  const firstHalf = sorted.slice(0, midPoint);
  const secondHalf = sorted.slice(midPoint);

  const firstCounts = countGaps(firstHalf);
  const secondCounts = countGaps(secondHalf);

  const allGapIds = new Set([...firstCounts.keys(), ...secondCounts.keys()]);
  const trends: GapTrend[] = [];

  for (const gapId of allGapIds) {
    const firstFreq = firstCounts.get(gapId) ?? 0;
    const secondFreq = secondCounts.get(gapId) ?? 0;
    const delta = secondFreq - firstFreq;

    let direction: "increasing" | "decreasing" | "stable" = "stable";
    if (delta > 0) direction = "increasing";
    else if (delta < 0) direction = "decreasing";

    trends.push({ gap_id: gapId, direction, delta });
  }

  return trends.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
}

function countGaps(records: CorpusRecord[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const r of records) {
    for (const gapId of r.gap_pattern.gap_ids) {
      counts.set(gapId, (counts.get(gapId) ?? 0) + 1);
    }
  }
  return counts;
}
