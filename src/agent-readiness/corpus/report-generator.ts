/**
 * SLICE-103-6: "State of Agent Readiness" report generator.
 *
 * Generates markdown + JSON reports from corpus data.
 * Pure functions — no side effects (write-to-disk is caller's responsibility).
 */

import type { CorpusRecord } from "./corpus-record.schema";
import type { CorpusStats } from "./corpus-store";
import type { OverallBenchmark } from "./benchmark.schema";
import {
  computeGapFrequency,
  computeScoreHistogram,
  computeCategoryDistribution,
  computePillarDistribution,
  computeStatusDistribution,
  computeTrend,
  computeVerticalComparison,
  type GapFrequency,
  type CategoryDistribution,
  type PillarDistribution,
  type StatusDistribution,
  type TrendPoint,
  type VerticalComparison,
} from "./aggregation-engine";

// ── Types ────────────────────────────────────────────────────

export interface StateOfAgentReadinessReport {
  id: string;
  title: string;
  generated_at: string;
  format: "json" | "markdown";
  period: {
    from: string;
    to: string;
  };
  methodology: {
    sample_size: number;
    ruleset_versions: string[];
    anonymization: string;
    exclusions: string;
  };
  headline: {
    total_scans: number;
    median_score: number;
    mean_score: number;
    pct_with_auth_gaps: number;
    pct_with_pricing_gaps: number;
    pct_with_runtime_traces: number;
  };
  top_gaps: GapFrequency[];
  category_leaderboard: {
    best: CategoryDistribution[];
    worst: CategoryDistribution[];
  };
  pillar_analysis: PillarDistribution[];
  status_distribution: StatusDistribution;
  trend: TrendPoint[];
  vertical_comparison: VerticalComparison[];
}

export interface ReportArchiveEntry {
  id: string;
  title: string;
  date: string;
  format: string;
}

// ── Report generation ────────────────────────────────────────

export function generateReport(
  records: CorpusRecord[],
  stats: CorpusStats,
  benchmark: OverallBenchmark | null,
): StateOfAgentReadinessReport {
  const totalScans = records.length;
  const scores = records.map((r) => r.scan_summary.score);
  const sortedScores = [...scores].sort((a, b) => a - b);
  const medianScore = sortedScores.length > 0
    ? sortedScores[Math.floor(sortedScores.length / 2)]
    : 0;
  const meanScore = scores.length > 0
    ? scores.reduce((sum, s) => sum + s, 0) / scores.length
    : 0;

  // Auth gaps
  const authGaps = records.filter((r) =>
    r.gap_pattern.gap_ids.some((g) => g.includes(":auth")),
  ).length;
  const pricingGaps = records.filter((r) =>
    r.gap_pattern.gap_ids.some((g) => g.includes(":pricing")),
  ).length;
  const runtimeTraces = records.filter((r) => r.has_runtime_trace).length;

  // Top 10 gaps
  const topGaps = computeGapFrequency(records).slice(0, 10);

  // Category leaderboard
  const catDist = computeCategoryDistribution(records).sort((a, b) => b.median - a.median);
  const best = catDist.slice(0, 5);
  const worst = catDist.slice(-5).reverse();

  // Pillar analysis
  const pillarAnalysis = computePillarDistribution(records);

  // Status distribution
  const statusDist = computeStatusDistribution(records);

  // Trend (weekly, last 90 days)
  const trend = computeTrend(records, "week");

  // Vertical comparison
  const verticalComparison = computeVerticalComparison(records);

  // Generate report ID from timestamp
  const now = new Date();
  const id = `soar-${now.toISOString().slice(0, 10)}`;
  const title = `State of Agent Readiness — ${now.toLocaleDateString("en-US", { month: "long", year: "numeric" })}`;

  return {
    id,
    title,
    generated_at: now.toISOString(),
    format: "json",
    period: {
      from: stats.date_range.earliest || now.toISOString(),
      to: stats.date_range.latest || now.toISOString(),
    },
    methodology: {
      sample_size: totalScans,
      ruleset_versions: stats.ruleset_versions,
      anonymization: "All records are PII-swept at write time. No URL, domain, IP, or email is persisted.",
      exclusions: "Records with insufficient data (fewer than 50 total) are not included in public benchmarks.",
    },
    headline: {
      total_scans: totalScans,
      median_score: Math.round(medianScore * 10) / 10,
      mean_score: Math.round(meanScore * 10) / 10,
      pct_with_auth_gaps: totalScans > 0 ? Math.round((authGaps / totalScans) * 1000) / 10 : 0,
      pct_with_pricing_gaps: totalScans > 0 ? Math.round((pricingGaps / totalScans) * 1000) / 10 : 0,
      pct_with_runtime_traces: totalScans > 0 ? Math.round((runtimeTraces / totalScans) * 1000) / 10 : 0,
    },
    top_gaps: topGaps,
    category_leaderboard: {
      best,
      worst,
    },
    pillar_analysis: pillarAnalysis,
    status_distribution: statusDist,
    trend,
    vertical_comparison: verticalComparison,
  };
}

// ── Markdown rendering ──────────────────────────────────────

export function renderReportMarkdown(report: StateOfAgentReadinessReport): string {
  const lines: string[] = [];

  lines.push(`# ${report.title}`);
  lines.push("");
  lines.push(`> Generated: ${report.generated_at}`);
  lines.push(`> Period: ${report.period.from} — ${report.period.to}`);
  lines.push(`> Sample size: ${report.methodology.sample_size} scans`);
  lines.push("");

  // Headline metrics
  lines.push("## Headline Metrics");
  lines.push("");
  lines.push(`| Metric | Value |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Total scans analyzed | ${report.headline.total_scans} |`);
  lines.push(`| Median score | ${report.headline.median_score} |`);
  lines.push(`| Mean score | ${report.headline.mean_score} |`);
  lines.push(`| % with auth gaps | ${report.headline.pct_with_auth_gaps}% |`);
  lines.push(`| % with pricing gaps | ${report.headline.pct_with_pricing_gaps}% |`);
  lines.push(`| % with runtime traces | ${report.headline.pct_with_runtime_traces}% |`);
  lines.push("");

  // Top gaps
  lines.push("## Top 10 Most Common Gaps");
  lines.push("");
  lines.push("| Gap ID | Frequency | % of Scans |");
  lines.push("|--------|-----------|------------|");
  for (const gap of report.top_gaps) {
    lines.push(`| ${gap.gap_id} | ${gap.frequency} | ${gap.pct.toFixed(1)}% |`);
  }
  lines.push("");

  // Category leaderboard
  lines.push("## Category Leaderboard");
  lines.push("");
  lines.push("### Best Categories (by median score)");
  lines.push("");
  lines.push("| Category | Median | Mean | P75 | P90 |");
  lines.push("|----------|--------|------|-----|-----|");
  for (const cat of report.category_leaderboard.best) {
    lines.push(`| ${cat.category} | ${cat.median.toFixed(1)} | ${cat.mean.toFixed(1)} | ${cat.percentiles.p75.toFixed(1)} | ${cat.percentiles.p90.toFixed(1)} |`);
  }
  lines.push("");
  lines.push("### Worst Categories (by median score)");
  lines.push("");
  lines.push("| Category | Median | Mean | P25 | P50 |");
  lines.push("|----------|--------|------|-----|-----|");
  for (const cat of report.category_leaderboard.worst) {
    lines.push(`| ${cat.category} | ${cat.median.toFixed(1)} | ${cat.mean.toFixed(1)} | ${cat.percentiles.p25.toFixed(1)} | ${cat.percentiles.p50.toFixed(1)} |`);
  }
  lines.push("");

  // Pillar analysis
  lines.push("## Pillar Analysis");
  lines.push("");
  lines.push("| Pillar | Mean | Median | P25 | P75 | P90 |");
  lines.push("|--------|------|--------|-----|-----|-----|");
  for (const p of report.pillar_analysis) {
    lines.push(`| ${p.pillar} | ${p.mean.toFixed(1)} | ${p.median.toFixed(1)} | ${p.percentiles.p25.toFixed(1)} | ${p.percentiles.p75.toFixed(1)} | ${p.percentiles.p90.toFixed(1)} |`);
  }
  lines.push("");

  // Status distribution
  lines.push("## Status Distribution");
  lines.push("");
  lines.push(`| Status | Count |`);
  lines.push(`|--------|-------|`);
  lines.push(`| VERIFIED | ${report.status_distribution.VERIFIED} |`);
  lines.push(`| INFERRED | ${report.status_distribution.INFERRED} |`);
  lines.push(`| GAP | ${report.status_distribution.GAP} |`);
  lines.push(`| CONFLICT | ${report.status_distribution.CONFLICT} |`);
  lines.push(`| NOT_APPLICABLE | ${report.status_distribution.NOT_APPLICABLE} |`);
  lines.push("");

  // Trend
  if (report.trend.length > 0) {
    lines.push("## Trend (Weekly)");
    lines.push("");
    lines.push("| Week | Mean Score | Median Score | Scans | Top Gap |");
    lines.push("|------|------------|--------------|-------|---------|");
    for (const t of report.trend) {
      lines.push(`| ${t.date} | ${t.mean_score.toFixed(1)} | ${t.median_score.toFixed(1)} | ${t.record_count} | ${t.top_gap_id} |`);
    }
    lines.push("");
  }

  // Vertical comparison
  if (report.vertical_comparison.length > 0) {
    lines.push("## Vertical Comparison");
    lines.push("");
    lines.push("| Vertical | Scans | Mean Score | Median Score | Top Gap |");
    lines.push("|----------|-------|------------|--------------|---------|");
    for (const v of report.vertical_comparison) {
      lines.push(`| ${v.vertical} | ${v.record_count} | ${v.mean_score.toFixed(1)} | ${v.median_score.toFixed(1)} | ${v.top_gaps[0]?.gap_id ?? "—"} |`);
    }
    lines.push("");
  }

  // Methodology
  lines.push("## Methodology");
  lines.push("");
  lines.push(`- **Sample size**: ${report.methodology.sample_size} scans`);
  lines.push(`- **Ruleset versions**: ${report.methodology.ruleset_versions.join(", ") || "unknown"}`);
  lines.push(`- **Anonymization**: ${report.methodology.anonymization}`);
  lines.push(`- **Exclusions**: ${report.methodology.exclusions}`);
  lines.push("");

  return lines.join("\n");
}
