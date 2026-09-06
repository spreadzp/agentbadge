/**
 * SLICE-103-7: Table formatters for CLI benchmark output.
 */

import type { OverallBenchmark, CategoryBenchmark, PillarBenchmark } from "../../corpus/benchmark.schema";
import type { CorpusStats } from "../../corpus/corpus-store";

function pad(str: string, len: number): string {
  return str.length >= len ? str : str + " ".repeat(len - str.length);
}

function scoreColor(score: number): string {
  if (score >= 75) return "\x1b[32m"; // green
  if (score >= 50) return "\x1b[33m"; // yellow
  return "\x1b[31m"; // red
}

const RESET = "\x1b[0m";

export function formatOverallBenchmarkTable(benchmark: OverallBenchmark): string {
  const lines: string[] = [];
  lines.push("╔══════════════════════════════════════════════════════════════╗");
  lines.push("║           Agent Readiness — Overall Benchmark                 ║");
  lines.push("╚══════════════════════════════════════════════════════════════╝");
  lines.push("");

  // Corpus stats
  const cs = benchmark.corpus_stats;
  lines.push(`Total Records: ${cs.total_records}`);
  lines.push(`Date Range:    ${cs.date_range.earliest} → ${cs.date_range.latest}`);
  lines.push(`Verticals:     ${cs.verticals.join(", ") || "none"}`);
  lines.push("");

  // Score histogram
  lines.push("Score Distribution:");
  for (const [bucket, count] of Object.entries(benchmark.score_histogram)) {
    const bar = "█".repeat(Math.min(count, 40));
    lines.push(`  ${pad(bucket, 10)} ${bar} ${count}`);
  }
  lines.push("");

  // Category benchmarks
  if (benchmark.category_benchmarks.length > 0) {
    lines.push("Category Benchmarks:");
    lines.push(`  ${pad("Category", 25)} ${pad("Mean", 8)} ${pad("Median", 8)} ${pad("P25", 8)} ${pad("P75", 8)} ${pad("P90", 8)}`);
    lines.push(`  ${"-".repeat(75)}`);
    for (const cat of benchmark.category_benchmarks) {
      const meanStr = `${scoreColor(cat.mean)}${cat.mean.toFixed(1)}${RESET}`;
      lines.push(`  ${pad(cat.category, 25)} ${meanStr}    ${cat.median.toFixed(1).padStart(6)}    ${cat.percentiles.p25.toFixed(1).padStart(6)}    ${cat.percentiles.p75.toFixed(1).padStart(6)}    ${cat.percentiles.p90.toFixed(1).padStart(6)}`);
    }
    lines.push("");
  }

  // Pillar benchmarks
  if (benchmark.pillar_benchmarks.length > 0) {
    lines.push("Pillar Benchmarks:");
    lines.push(`  ${pad("Pillar", 25)} ${pad("Mean", 8)} ${pad("Median", 8)}`);
    lines.push(`  ${"-".repeat(45)}`);
    for (const p of benchmark.pillar_benchmarks) {
      lines.push(`  ${pad(p.pillar, 25)} ${p.mean.toFixed(1).padStart(6)}    ${p.median.toFixed(1).padStart(6)}`);
    }
    lines.push("");
  }

  // Top gaps
  if (benchmark.top_gaps.length > 0) {
    lines.push("Top Gaps:");
    for (const gap of benchmark.top_gaps.slice(0, 10)) {
      lines.push(`  ${pad(gap.gap_id, 40)} freq: ${gap.frequency}  (${gap.pct.toFixed(1)}%)`);
    }
  }

  return lines.join("\n");
}

export function formatCategoryBenchmarkTable(benchmark: CategoryBenchmark): string {
  const lines: string[] = [];
  lines.push(`Category Benchmark: ${benchmark.category}`);
  lines.push(`Sample Count: ${benchmark.sample_count}`);
  lines.push("");
  lines.push(`  Mean:    ${scoreColor(benchmark.mean)}${benchmark.mean.toFixed(1)}${RESET}`);
  lines.push(`  Median:  ${benchmark.median.toFixed(1)}`);
  lines.push(`  Stddev:  ${benchmark.stddev.toFixed(1)}`);
  lines.push(`  P25:     ${benchmark.percentiles.p25.toFixed(1)}`);
  lines.push(`  P50:     ${benchmark.percentiles.p50.toFixed(1)}`);
  lines.push(`  P75:     ${benchmark.percentiles.p75.toFixed(1)}`);
  lines.push(`  P90:     ${benchmark.percentiles.p90.toFixed(1)}`);
  lines.push("");

  if (benchmark.common_gaps.length > 0) {
    lines.push("Common Gaps:");
    for (const gap of benchmark.common_gaps) {
      lines.push(`  ${pad(gap.gap_id, 40)} freq: ${gap.frequency}  (${gap.pct.toFixed(1)}%)`);
    }
  }

  return lines.join("\n");
}

export function formatPillarBenchmarkTable(benchmark: PillarBenchmark): string {
  const lines: string[] = [];
  lines.push(`Pillar Benchmark: ${benchmark.pillar}`);
  lines.push(`Sample Count: ${benchmark.sample_count}`);
  lines.push("");
  lines.push(`  Mean:    ${scoreColor(benchmark.mean)}${benchmark.mean.toFixed(1)}${RESET}`);
  lines.push(`  Median:  ${benchmark.median.toFixed(1)}`);
  lines.push(`  P25:     ${benchmark.percentiles.p25.toFixed(1)}`);
  lines.push(`  P50:     ${benchmark.percentiles.p50.toFixed(1)}`);
  lines.push(`  P75:     ${benchmark.percentiles.p75.toFixed(1)}`);
  lines.push(`  P90:     ${benchmark.percentiles.p90.toFixed(1)}`);

  return lines.join("\n");
}

export function formatCorpusStatsTable(stats: CorpusStats): string {
  const lines: string[] = [];
  lines.push("Corpus Statistics");
  lines.push("=================");
  lines.push(`Total Records:     ${stats.total_records}`);
  lines.push(`Date Range:        ${stats.date_range.earliest} → ${stats.date_range.latest}`);
  lines.push(`Ruleset Versions:  ${stats.ruleset_versions.join(", ") || "none"}`);
  lines.push(`Verticals:         ${stats.verticals.join(", ") || "none"}`);

  return lines.join("\n");
}
