/**
 * SLICE-103-8: Web UI — public benchmarks dashboard, category detail, report archive, report viewer.
 *
 * Server-side rendered pages using hono/html + LandingLayout.
 * Data fetched server-side from benchmark API endpoints.
 */

import { Hono } from "hono";
import { LandingLayout } from "../../views/landing/layout";
import { FileCorpusStore } from "../../agent-readiness/corpus/corpus-store";
import {
  computeOverallBenchmark,
  computeCategoryBenchmark,
} from "../../agent-readiness/corpus/benchmark-engine";
import { computeTrend } from "../../agent-readiness/corpus/aggregation-engine";
import type { OverallBenchmark, CategoryBenchmark } from "../../agent-readiness/corpus/benchmark.schema";
import type { CorpusStats } from "../../agent-readiness/corpus/corpus-store";

export const benchmarkPageRoutes = new Hono();

const store = new FileCorpusStore();

// ── Helpers ──────────────────────────────────────────────────

function scoreColor(score: number): string {
  if (score >= 75) return "text-green-400";
  if (score >= 50) return "text-yellow-400";
  return "text-red-400";
}

function scoreBg(score: number): string {
  if (score >= 75) return "bg-green-500";
  if (score >= 50) return "bg-yellow-500";
  return "bg-red-500";
}

function barWidth(value: number, max: number): string {
  return `${Math.min((value / max) * 100, 100)}%`;
}

// ── GET /benchmarks — main dashboard ─────────────────────────

benchmarkPageRoutes.get("/benchmarks", async (c) => {
  const records = await store.query({});
  const stats = await store.getStats();
  const result = computeOverallBenchmark(records, stats);

  const isInsufficient = "insufficient_data" in result;

  const trend = computeTrend(records.slice(-50), "week");
  const trendSparkline = trend
    .map((t) => t.mean_score.toFixed(0))
    .join(",");

  const content = isInsufficient
    ? renderInsufficientData(stats)
    : renderBenchmarkDashboard(result as OverallBenchmark, stats, trendSparkline);

  const html_ = LandingLayout(
    content,
    "Agent Readiness Benchmarks — Industry Score Distribution",
    {
      title: "Agent Readiness Benchmarks — Industry Score Distribution",
      description:
        "Cross-scan industry benchmarks: score distribution, category leaderboard, pillar analysis, and most common gaps across the agent readiness ecosystem.",
      path: "/benchmarks",
    },
  );

  return c.html(html_.toString(), 200, { "Cache-Control": "public, max-age=3600" });
});

// ── GET /benchmarks/:category — category detail ──────────────

benchmarkPageRoutes.get("/benchmarks/:category", async (c) => {
  const category = c.req.param("category");

  // Prevent collision with /benchmarks/reports
  if (category === "reports") {
    return c.html(renderReportArchive().toString(), 200);
  }

  const records = await store.query({});
  const result = computeCategoryBenchmark(records, category);

  const content = "insufficient_data" in result
    ? renderInsufficientData({ total_records: result.sample_count, date_range: { earliest: "", latest: "" }, ruleset_versions: [], verticals: [] })
    : renderCategoryDetail(result as CategoryBenchmark, category);

  const html_ = LandingLayout(
    content,
    `Benchmark: ${category} — Agent Readiness`,
    {
      title: `Benchmark: ${category} — Agent Readiness`,
      description: `Per-category benchmark for ${category}: percentiles, score distribution, and common gaps.`,
      path: `/benchmarks/${category}`,
    },
  );

  return c.html(html_.toString(), 200, { "Cache-Control": "public, max-age=3600" });
});

// ── GET /benchmarks/reports — report archive ─────────────────

benchmarkPageRoutes.get("/benchmarks/reports", async (c) => {
  const html_ = LandingLayout(
    renderReportArchive(),
    "State of Agent Readiness Reports — Archive",
    {
      title: "State of Agent Readiness Reports — Archive",
      description: "Archive of State of Agent Readiness reports with key metrics and trends.",
      path: "/benchmarks/reports",
    },
  );
  return c.html(html_.toString(), 200, { "Cache-Control": "public, max-age=3600" });
});

// ── GET /benchmarks/reports/:id — report viewer ──────────────

benchmarkPageRoutes.get("/benchmarks/reports/:id", async (c) => {
  const id = c.req.param("id");
  const html_ = LandingLayout(
    renderReportViewer(id),
    `Report: ${id} — State of Agent Readiness`,
    {
      title: `Report: ${id} — State of Agent Readiness`,
      description: "State of Agent Readiness report with industry benchmarks and trends.",
      path: `/benchmarks/reports/${id}`,
    },
  );
  return c.html(html_.toString(), 200, { "Cache-Control": "public, max-age=3600" });
});

// ── Render functions ─────────────────────────────────────────

function renderInsufficientData(stats: CorpusStats): string {
  return `
    <div class="mx-auto max-w-3xl px-4 py-16 text-center">
      <h1 class="text-3xl font-bold text-white mb-4">Agent Readiness Benchmarks</h1>
      <div class="rounded-xl border border-slate-700 bg-slate-900/50 p-8 mt-8">
        <p class="text-xl text-slate-300 mb-4">Insufficient Data</p>
        <p class="text-slate-400 mb-2">We need at least 50 scans to generate industry benchmarks.</p>
        <p class="text-slate-400 mb-6">Current corpus: <span class="text-white font-semibold">${stats.total_records}</span> scans</p>
        <a href="/scan" class="inline-block rounded-lg bg-indigo-600 px-6 py-3 text-white font-semibold hover:bg-indigo-500 transition-colors">
          Scan your API to contribute
        </a>
      </div>
    </div>
  `;
}

function renderBenchmarkDashboard(benchmark: OverallBenchmark, stats: CorpusStats, trendSparkline: string): string {
  const cs = benchmark.corpus_stats;
  const topGap = benchmark.top_gaps[0]?.gap_id ?? "—";

  // Headline metrics
  let headline = `
    <div class="mx-auto max-w-6xl px-4 py-8">
      <h1 class="text-3xl font-bold text-white mb-2">Agent Readiness Benchmarks</h1>
      <p class="text-slate-400 mb-8">Cross-scan industry benchmarks from ${cs.total_records} analyzed APIs</p>

      <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <div class="rounded-xl border border-slate-700 bg-slate-900/50 p-6">
          <p class="text-sm text-slate-400 mb-1">Total Scans Analyzed</p>
          <p class="text-2xl font-bold text-white">${cs.total_records}</p>
        </div>
        <div class="rounded-xl border border-slate-700 bg-slate-900/50 p-6">
          <p class="text-sm text-slate-400 mb-1">Most Common Gap</p>
          <p class="text-lg font-semibold ${scoreColor(40)}">${topGap}</p>
        </div>
        <div class="rounded-xl border border-slate-700 bg-slate-900/50 p-6">
          <p class="text-sm text-slate-400 mb-1">Verticals</p>
          <p class="text-lg font-semibold text-white">${cs.verticals.join(", ") || "—"}</p>
        </div>
      </div>
  `;

  // Score histogram
  let histogram = `
    <div class="rounded-xl border border-slate-700 bg-slate-900/50 p-6 mb-8">
      <h2 class="text-xl font-semibold text-white mb-4">Score Distribution</h2>
      <div class="space-y-2">
  `;
  for (const [bucket, count] of Object.entries(benchmark.score_histogram)) {
    const maxCount = Math.max(...Object.values(benchmark.score_histogram), 1);
    histogram += `
        <div class="flex items-center gap-3">
          <span class="text-sm text-slate-400 w-20">${bucket}</span>
          <div class="flex-1 bg-slate-800 rounded-full h-6 overflow-hidden">
            <div class="${scoreBg(parseInt(bucket))} h-full rounded-full transition-all" style="width: ${barWidth(count, maxCount)}"></div>
          </div>
          <span class="text-sm text-slate-300 w-12 text-right">${count}</span>
        </div>
    `;
  }
  histogram += `</div></div>`;

  // Category leaderboard
  let leaderboard = `
    <div class="rounded-xl border border-slate-700 bg-slate-900/50 p-6 mb-8">
      <h2 class="text-xl font-semibold text-white mb-4">Category Leaderboard</h2>
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead>
            <tr class="text-slate-400 border-b border-slate-700">
              <th class="text-left py-2 px-3">Category</th>
              <th class="text-right py-2 px-3">Mean</th>
              <th class="text-right py-2 px-3">Median</th>
              <th class="text-right py-2 px-3">P25</th>
              <th class="text-right py-2 px-3">P75</th>
              <th class="text-right py-2 px-3">P90</th>
            </tr>
          </thead>
          <tbody>
  `;
  for (const cat of benchmark.category_benchmarks.sort((a, b) => b.mean - a.mean)) {
    leaderboard += `
            <tr class="border-b border-slate-800 hover:bg-slate-800/50">
              <td class="py-2 px-3"><a href="/benchmarks/${cat.category}" class="text-indigo-400 hover:text-indigo-300">${cat.category}</a></td>
              <td class="text-right py-2 px-3 ${scoreColor(cat.mean)} font-semibold">${cat.mean.toFixed(1)}</td>
              <td class="text-right py-2 px-3 text-slate-300">${cat.median.toFixed(1)}</td>
              <td class="text-right py-2 px-3 text-slate-400">${cat.percentiles.p25.toFixed(1)}</td>
              <td class="text-right py-2 px-3 text-slate-400">${cat.percentiles.p75.toFixed(1)}</td>
              <td class="text-right py-2 px-3 text-slate-400">${cat.percentiles.p90.toFixed(1)}</td>
            </tr>
    `;
  }
  leaderboard += `</tbody></table></div></div>`;

  // Pillar analysis
  let pillars = `
    <div class="rounded-xl border border-slate-700 bg-slate-900/50 p-6 mb-8">
      <h2 class="text-xl font-semibold text-white mb-4">Pillar Analysis</h2>
      <div class="space-y-3">
  `;
  for (const p of benchmark.pillar_benchmarks) {
    pillars += `
        <div class="flex items-center gap-3">
          <span class="text-sm text-slate-300 w-32">${p.pillar}</span>
          <div class="flex-1 bg-slate-800 rounded-full h-8 overflow-hidden">
            <div class="${scoreBg(p.mean)} h-full rounded-full flex items-center justify-end pr-2 transition-all" style="width: ${barWidth(p.mean, 100)}">
              <span class="text-xs text-white font-semibold">${p.mean.toFixed(1)}</span>
            </div>
          </div>
        </div>
    `;
  }
  pillars += `</div></div>`;

  // Top gaps
  let gaps = `
    <div class="rounded-xl border border-slate-700 bg-slate-900/50 p-6 mb-8">
      <h2 class="text-xl font-semibold text-white mb-4">Top 10 Most Common Gaps</h2>
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead>
            <tr class="text-slate-400 border-b border-slate-700">
              <th class="text-left py-2 px-3">Gap ID</th>
              <th class="text-right py-2 px-3">Frequency</th>
              <th class="text-right py-2 px-3">% of Scans</th>
            </tr>
          </thead>
          <tbody>
  `;
  for (const gap of benchmark.top_gaps.slice(0, 10)) {
    gaps += `
            <tr class="border-b border-slate-800">
              <td class="py-2 px-3 text-slate-300 font-mono text-xs">${gap.gap_id}</td>
              <td class="text-right py-2 px-3 text-slate-400">${gap.frequency}</td>
              <td class="text-right py-2 px-3 ${scoreColor(100 - gap.pct)}">${gap.pct.toFixed(1)}%</td>
            </tr>
    `;
  }
  gaps += `</tbody></table></div></div>`;

  // Trend sparkline
  let trend = "";
  if (trendSparkline) {
    trend = `
      <div class="rounded-xl border border-slate-700 bg-slate-900/50 p-6 mb-8">
        <h2 class="text-xl font-semibold text-white mb-4">Score Trend (Last 90 Days)</h2>
        <div class="flex items-end gap-1 h-24">
          ${trendSparkline.split(",").map((v) => `<div class="flex-1 bg-indigo-500 rounded-t" style="height: ${barWidth(parseInt(v), 100)}; min-height: 4px;" title="${v}"></div>`).join("")}
        </div>
      </div>
    `;
  }

  // CTA
  const cta = `
    <div class="text-center py-8">
      <a href="/scan" class="inline-block rounded-lg bg-indigo-600 px-8 py-4 text-white font-semibold text-lg hover:bg-indigo-500 transition-colors">
        Scan your API →
      </a>
    </div>
  `;

  return headline + histogram + leaderboard + pillars + gaps + trend + cta + `</div>`;
}

function renderCategoryDetail(benchmark: CategoryBenchmark, category: string): string {
  return `
    <div class="mx-auto max-w-4xl px-4 py-8">
      <h1 class="text-3xl font-bold text-white mb-2">Benchmark: ${category}</h1>
      <p class="text-slate-400 mb-8">Based on ${benchmark.sample_count} scans</p>

      <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <div class="rounded-xl border border-slate-700 bg-slate-900/50 p-4 text-center">
          <p class="text-sm text-slate-400 mb-1">P25</p>
          <p class="text-xl font-bold ${scoreColor(benchmark.percentiles.p25)}">${benchmark.percentiles.p25.toFixed(1)}</p>
        </div>
        <div class="rounded-xl border border-slate-700 bg-slate-900/50 p-4 text-center">
          <p class="text-sm text-slate-400 mb-1">P50 (Median)</p>
          <p class="text-xl font-bold ${scoreColor(benchmark.percentiles.p50)}">${benchmark.percentiles.p50.toFixed(1)}</p>
        </div>
        <div class="rounded-xl border border-slate-700 bg-slate-900/50 p-4 text-center">
          <p class="text-sm text-slate-400 mb-1">P75</p>
          <p class="text-xl font-bold ${scoreColor(benchmark.percentiles.p75)}">${benchmark.percentiles.p75.toFixed(1)}</p>
        </div>
        <div class="rounded-xl border border-slate-700 bg-slate-900/50 p-4 text-center">
          <p class="text-sm text-slate-400 mb-1">P90</p>
          <p class="text-xl font-bold ${scoreColor(benchmark.percentiles.p90)}">${benchmark.percentiles.p90.toFixed(1)}</p>
        </div>
      </div>

      <div class="rounded-xl border border-slate-700 bg-slate-900/50 p-6 mb-8">
        <h2 class="text-xl font-semibold text-white mb-4">Statistics</h2>
        <div class="grid grid-cols-3 gap-4">
          <div><p class="text-sm text-slate-400">Mean</p><p class="text-lg font-semibold ${scoreColor(benchmark.mean)}">${benchmark.mean.toFixed(1)}</p></div>
          <div><p class="text-sm text-slate-400">Median</p><p class="text-lg font-semibold text-white">${benchmark.median.toFixed(1)}</p></div>
          <div><p class="text-sm text-slate-400">Std Dev</p><p class="text-lg font-semibold text-white">${benchmark.stddev.toFixed(1)}</p></div>
        </div>
      </div>

      ${benchmark.common_gaps.length > 0 ? `
      <div class="rounded-xl border border-slate-700 bg-slate-900/50 p-6 mb-8">
        <h2 class="text-xl font-semibold text-white mb-4">Common Gaps in ${category}</h2>
        <table class="w-full text-sm">
          <thead><tr class="text-slate-400 border-b border-slate-700">
            <th class="text-left py-2 px-3">Gap ID</th>
            <th class="text-right py-2 px-3">Frequency</th>
            <th class="text-right py-2 px-3">% of Scans</th>
          </tr></thead>
          <tbody>
          ${benchmark.common_gaps.map((g) => `
            <tr class="border-b border-slate-800">
              <td class="py-2 px-3 text-slate-300 font-mono text-xs">${g.gap_id}</td>
              <td class="text-right py-2 px-3 text-slate-400">${g.frequency}</td>
              <td class="text-right py-2 px-3 text-slate-400">${g.pct.toFixed(1)}%</td>
            </tr>
          `).join("")}
          </tbody>
        </table>
      </div>` : ""}

      <div class="flex gap-4 mb-8">
        <a href="/benchmarks" class="text-indigo-400 hover:text-indigo-300">← Back to Benchmarks</a>
        <a href="/scan" class="ml-auto inline-block rounded-lg bg-indigo-600 px-6 py-3 text-white font-semibold hover:bg-indigo-500 transition-colors">Scan your API →</a>
      </div>
    </div>
  `;
}

function renderReportArchive(): string {
  return `
    <div class="mx-auto max-w-4xl px-4 py-8">
      <h1 class="text-3xl font-bold text-white mb-2">State of Agent Readiness Reports</h1>
      <p class="text-slate-400 mb-8">Archive of industry benchmark reports</p>

      <div class="rounded-xl border border-slate-700 bg-slate-900/50 p-8 text-center">
        <p class="text-slate-400 mb-4">No reports have been generated yet.</p>
        <p class="text-sm text-slate-500">Reports are generated periodically once sufficient corpus data is available.</p>
      </div>

      <div class="text-center py-8">
        <a href="/scan" class="inline-block rounded-lg bg-indigo-600 px-8 py-4 text-white font-semibold text-lg hover:bg-indigo-500 transition-colors">
          Scan your API →
        </a>
      </div>
    </div>
  `;
}

function renderReportViewer(id: string): string {
  return `
    <div class="mx-auto max-w-4xl px-4 py-8">
      <h1 class="text-3xl font-bold text-white mb-2">Report: ${id}</h1>
      <p class="text-slate-400 mb-8">State of Agent Readiness</p>

      <div class="rounded-xl border border-slate-700 bg-slate-900/50 p-8 text-center">
        <p class="text-slate-400 mb-4">This report is not yet available.</p>
        <p class="text-sm text-slate-500">Report generation requires sufficient corpus data (50+ scans).</p>
      </div>

      <div class="flex gap-4 mt-8">
        <a href="/benchmarks/reports" class="text-indigo-400 hover:text-indigo-300">← Back to Reports</a>
        <a href="/scan" class="ml-auto inline-block rounded-lg bg-indigo-600 px-6 py-3 text-white font-semibold hover:bg-indigo-500 transition-colors">Scan your API →</a>
      </div>
    </div>
  `;
}
