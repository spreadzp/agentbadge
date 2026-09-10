/**
 * SLICE-99-8: Web monitoring dashboard view.
 *
 * SSR views using hono/html — same pattern as dashboard.ts.
 * Consumes API-shaped data (no direct store access from views).
 */

import { html, raw } from "hono/html";
import { Layout } from "./layout";
import type { MonitoredProject, RunRecord, RegressionReport } from "../agent-readiness/monitoring/monitoring-types";

export interface MonitoringPageData {
  projects: Array<
    MonitoredProject & {
      latest_score?: number;
      latest_grade?: string;
      latest_outcome?: "ok" | "error";
      score_history?: number[];
    }
  >;
}

export interface MonitoringDetailData {
  project: MonitoringPageData["projects"][0];
  runs: RunRecord[];
  alerts: Array<{ alert_id: string; channel: string; sent_at: string; finding: { rule: string; severity: string } }>;
  regressions: RegressionReport["findings"];
}

/**
 * Sparkline SVG from score history.
 */
function Sparkline(scores: number[]): string {
  if (scores.length < 2) return "";
  const w = 80;
  const h = 24;
  const max = Math.max(...scores);
  const min = Math.min(...scores);
  const range = max - min || 1;
  const points = scores
    .map((s, i) => {
      const x = (i / (scores.length - 1)) * w;
      const y = h - ((s - min) / range) * h;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" class="inline-block" aria-label="Score trend">
    <polyline points="${points}" fill="none" stroke="currentColor" stroke-width="1.5" class="text-emerald-400" />
  </svg>`;
}

/**
 * Timeline chart SVG — score over time.
 */
function TimelineChart(runs: RunRecord[]): string {
  const scores = runs
    .filter((r) => r.outcome === "ok")
    .map((r) => r.summary.score)
    .reverse(); // oldest first
  if (scores.length < 2) return `<p class="text-slate-500 text-sm">Not enough data for chart yet.</p>`;

  const w = 400;
  const h = 120;
  const max = Math.max(...scores, 100);
  const min = Math.min(...scores, 0);
  const range = max - min || 1;
  const points = scores
    .map((s, i) => {
      const x = (i / (scores.length - 1)) * w;
      const y = h - ((s - min) / range) * h;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" class="w-full max-w-lg" role="img" aria-label="Score timeline chart">
    <polyline points="${points}" fill="none" stroke="currentColor" stroke-width="2" class="text-emerald-400" />
    ${scores
      .map((s, i) => {
        const x = (i / (scores.length - 1)) * w;
        const y = h - ((s - min) / range) * h;
        return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3" class="text-emerald-400 fill-current" />`;
      })
      .join("")}
  </svg>`;
}

export function MonitoringProjectCard(
  project: MonitoringPageData["projects"][0],
): ReturnType<typeof html> {
  const delta =
    project.score_history && project.score_history.length >= 2
      ? project.latest_score! - project.score_history[project.score_history.length - 2]
      : null;

  return html`<div class="rounded-lg border border-slate-800 bg-slate-900 p-4 hover:border-slate-700 transition-colors" data-project-id="${project.project_id}">
    <div class="flex items-center justify-between mb-2">
      <h3 class="text-lg font-semibold text-slate-100">${project.name}</h3>
      <span class="text-xs px-2 py-0.5 rounded ${project.enabled ? "bg-emerald-500/10 text-emerald-300 border border-emerald-500/40" : "bg-slate-700 text-slate-400"}">${project.enabled ? "enabled" : "paused"}</span>
    </div>
    <p class="text-sm text-slate-400 mb-2">${project.url}</p>
    <div class="flex items-center gap-4 text-sm">
      <span class="text-2xl font-bold ${project.latest_grade === "A" || project.latest_grade === "B" ? "text-emerald-400" : "text-amber-400"}">${project.latest_score ?? "—"}</span>
      <span class="text-slate-500">Grade ${project.latest_grade ?? "—"}</span>
      ${delta !== null ? html`<span class="${delta < 0 ? "text-red-400" : "text-emerald-400"}">${delta > 0 ? "+" : ""}${delta}</span>` : ""}
      ${project.score_history && project.score_history.length >= 2 ? raw(Sparkline(project.score_history)) : ""}
    </div>
    <div class="mt-3 flex items-center justify-between text-xs text-slate-500">
      <span>Next: ${project.next_run_at.slice(0, 10)}</span>
      <span class="px-2 py-0.5 rounded ${project.latest_outcome === "ok" ? "bg-emerald-500/10 text-emerald-300" : "bg-red-500/10 text-red-300"}">${project.latest_outcome ?? "—"}</span>
    </div>
    <div class="mt-3 flex gap-2">
      <a href="/monitoring/${project.project_id}" class="text-xs text-emerald-400 hover:underline">View detail →</a>
    </div>
  </div>`;
}

export function MonitoringEmptyState(): ReturnType<typeof html> {
  return html`<div class="rounded-lg border border-slate-800 bg-slate-900 p-12 text-center">
    <h2 class="text-xl font-semibold text-slate-200 mb-2">Monitoring keeps you fixed — register your first project</h2>
    <p class="text-slate-400 mb-6">Continuous monitoring scans your API daily, detects regressions, and alerts you before users notice.</p>
    <p class="text-sm text-slate-500">Free: 1 project, daily scans, webhook + email alerts.</p>
  </div>`;
}

export function MonitoringAddForm(): ReturnType<typeof html> {
  return html`<div class="rounded-lg border border-slate-800 bg-slate-900 p-6">
    <h3 class="text-lg font-semibold text-slate-100 mb-4">Add Project</h3>
    <form method="POST" action="/monitoring/projects" class="space-y-4">
      <div>
        <label class="block text-sm text-slate-400 mb-1">Name</label>
        <input type="text" name="name" required class="w-full rounded bg-slate-800 border border-slate-700 px-3 py-2 text-slate-100" placeholder="My API" />
      </div>
      <div>
        <label class="block text-sm text-slate-400 mb-1">URL</label>
        <input type="url" name="url" required class="w-full rounded bg-slate-800 border border-slate-700 px-3 py-2 text-slate-100" placeholder="https://api.example.com" />
      </div>
      <div>
        <label class="block text-sm text-slate-400 mb-1">Schedule</label>
        <select name="schedule" class="w-full rounded bg-slate-800 border border-slate-700 px-3 py-2 text-slate-100">
          <option value='{"kind":"daily","hour_utc":6}'>Daily at 06:00 UTC</option>
          <option value='{"kind":"weekly","hour_utc":6,"day_of_week":1}'>Weekly on Monday at 06:00 UTC</option>
        </select>
        <p class="text-xs text-slate-500 mt-1">Free: 1 project, daily scans only. <a href="/pricing" class="text-emerald-400 hover:underline">Upgrade for weekly →</a></p>
      </div>
      <div>
        <label class="block text-sm text-slate-400 mb-1">Channels</label>
        <input type="text" name="channels" required class="w-full rounded bg-slate-800 border border-slate-700 px-3 py-2 text-slate-100" placeholder='[{"type":"webhook","target":"https://hook.example.com"}]' />
        <p class="text-xs text-slate-500 mt-1">Free: webhook + email only.</p>
      </div>
      <div>
        <label class="block text-sm text-slate-400 mb-1">Webhook Secret (optional)</label>
        <input type="password" name="webhook_secret" class="w-full rounded bg-slate-800 border border-slate-700 px-3 py-2 text-slate-100" placeholder="HMAC signing secret" />
      </div>
      <button type="submit" class="rounded bg-emerald-600 px-4 py-2 text-white hover:bg-emerald-500 transition-colors">Add Project</button>
    </form>
  </div>`;
}

export function MonitoringProjectDetail(data: MonitoringDetailData): ReturnType<typeof html> {
  const { project, runs, alerts, regressions } = data;

  const runsHtml = runs
    .map(
      (r) => html`<tr class="border-t border-slate-800">
        <td class="py-2 px-3 text-sm text-slate-300">${r.started_at.slice(0, 16).replace("T", " ")}</td>
        <td class="py-2 px-3 text-sm text-slate-400">${r.trigger}</td>
        <td class="py-2 px-3 text-sm">${r.outcome === "ok" ? "✅" : "❌"}</td>
        <td class="py-2 px-3 text-sm text-slate-300">${r.outcome === "ok" ? r.summary.score : "—"}</td>
        <td class="py-2 px-3 text-sm text-slate-400">${r.outcome === "ok" ? r.summary.grade : "—"}</td>
      </tr>`,
    )
    .join("");

  const regressionsHtml = regressions.length
    ? regressions
      .map((f) => {
        const id = (f as any).gap_id ?? (f as any).rule_id ?? "";
        const deltaStr = Object.entries(f.delta)
          .map(([k, v]) => `${k}=${v}`)
          .join(", ");
        return html`<div class="rounded border border-amber-500/30 bg-amber-500/5 p-3 mb-2">
            <div class="flex items-center justify-between">
              <span class="text-sm font-mono text-amber-300">${f.rule}${id ? `: ${id}` : ""}</span>
              <span class="text-xs px-2 py-0.5 rounded ${f.severity === "critical" ? "bg-red-500/10 text-red-300" : f.severity === "warning" ? "bg-amber-500/10 text-amber-300" : "bg-slate-700 text-slate-400"}">${f.severity}</span>
            </div>
            <p class="text-xs text-slate-400 mt-1">${deltaStr}</p>
          </div>`;
      })
      .join("")
    : html`<p class="text-slate-500 text-sm">No regressions detected.</p>`;

  const alertsHtml = alerts.length
    ? alerts
      .map(
        (a) =>
          html`<tr class="border-t border-slate-800">
              <td class="py-2 px-3 text-sm text-slate-300">${a.sent_at.slice(0, 16).replace("T", " ")}</td>
              <td class="py-2 px-3 text-sm text-slate-400">${a.channel}</td>
              <td class="py-2 px-3 text-sm text-amber-300">${a.finding.rule}</td>
              <td class="py-2 px-3 text-sm text-slate-400">${a.finding.severity}</td>
            </tr>`,
      )
      .join("")
    : html`<tr><td colspan="4" class="py-4 text-center text-slate-500 text-sm">No alerts yet.</td></tr>`;

  return html`<div class="max-w-4xl mx-auto p-6">
    <div class="flex items-center justify-between mb-6">
      <div>
        <h1 class="text-2xl font-bold text-slate-100">${project.name}</h1>
        <p class="text-sm text-slate-400">${project.url}</p>
      </div>
      <div class="flex gap-2">
        <form method="POST" action="/monitoring/${project.project_id}/run" class="inline">
          <button type="submit" class="rounded bg-emerald-600 px-3 py-1.5 text-sm text-white hover:bg-emerald-500">Run now</button>
        </form>
        <form method="POST" action="/monitoring/${project.project_id}/test-alert" class="inline">
          <button type="submit" class="rounded border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800">Test alert</button>
        </form>
      </div>
    </div>

    <div class="rounded-lg border border-slate-800 bg-slate-900 p-6 mb-6">
      <h2 class="text-lg font-semibold text-slate-100 mb-4">Score Timeline</h2>
      ${raw(TimelineChart(runs))}
    </div>

    <div class="rounded-lg border border-slate-800 bg-slate-900 p-6 mb-6">
      <h2 class="text-lg font-semibold text-slate-100 mb-4">Run History</h2>
      <table class="w-full">
        <thead>
          <tr class="text-left text-xs text-slate-500">
            <th class="py-2 px-3">Time</th>
            <th class="py-2 px-3">Trigger</th>
            <th class="py-2 px-3">Outcome</th>
            <th class="py-2 px-3">Score</th>
            <th class="py-2 px-3">Grade</th>
          </tr>
        </thead>
        <tbody>${raw(runsHtml.toString())}</tbody>
      </table>
    </div>

    <div class="rounded-lg border border-slate-800 bg-slate-900 p-6 mb-6">
      <h2 class="text-lg font-semibold text-slate-100 mb-4">Regression Diff</h2>
      ${raw(regressionsHtml.toString())}
    </div>

    <div class="rounded-lg border border-slate-800 bg-slate-900 p-6">
      <h2 class="text-lg font-semibold text-slate-100 mb-4">Alert Log</h2>
      <table class="w-full">
        <thead>
          <tr class="text-left text-xs text-slate-500">
            <th class="py-2 px-3">Sent</th>
            <th class="py-2 px-3">Channel</th>
            <th class="py-2 px-3">Rule</th>
            <th class="py-2 px-3">Severity</th>
          </tr>
        </thead>
        <tbody>${raw(alertsHtml.toString())}</tbody>
      </table>
    </div>
  </div>`;
}

export function MonitoringPage(data: MonitoringPageData): string {
  const { projects } = data;

  const projectsHtml =
    projects.length > 0
      ? html`<div class="grid gap-4 md:grid-cols-2 lg:grid-cols-3 mb-8">
          ${raw(projects.map((p) => MonitoringProjectCard(p).toString()).join(""))}
        </div>`
      : MonitoringEmptyState();

  const tierNotice = html`<div class="mb-6 text-sm text-slate-400">
    <span class="font-semibold text-slate-300">Free:</span> 1 project, daily scans, webhook + email alerts.
    <a href="/pricing" class="text-emerald-400 hover:underline">Upgrade →</a>
  </div>`;

  const content = html`<div class="max-w-6xl mx-auto p-6">
        <h1 class="text-3xl font-bold text-slate-100 mb-2">Monitoring</h1>
        <p class="text-slate-400 mb-6">Continuous monitoring scans your API, detects regressions, and alerts you before users notice.</p>
        ${tierNotice}
        ${projectsHtml}
        ${raw(MonitoringAddForm().toString())}
        <noscript>
          <p class="text-slate-400 mt-4">Monitoring dashboard shows project scores, run history, and alerts. Enable JavaScript for interactive features.</p>
        </noscript>
      </div>`;

  return Layout(
    String(content),
    "Monitoring — AgentBadge",
    { title: "Monitoring", description: "Continuous API monitoring with regression detection and alerts", path: "/monitoring" },
  );
}
