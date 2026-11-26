/**
 * EPIC-232 (SLICE-232-10, E10): /admin/ai/metrics — §17.3 quality
 * projection rendered on-demand (D-232-6: no metric tables).
 * Human Intervention Rate is labeled directional — a signal to
 * watch, never a target to optimize.
 */

import { html } from "hono/html";

import type { AiMetrics } from "../../server/lib/ai/metrics/projection";

const inputCls =
  "rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200";
const th =
  "px-2 py-1.5 text-left text-[11px] font-semibold uppercase text-slate-500";
const td = "px-2 py-1.5 align-top text-xs text-slate-300";

const kv = (label: string, v: unknown) => html`<div class="flex gap-2">
  <span class="w-52 text-slate-500">${label}</span>
  <span class="font-mono text-slate-200">${String(v)}</span>
</div>`;

const pct = (x: number | null) =>
  x === null ? "—" : `${(x * 100).toFixed(1)}%`;

const ms = (x: number | null) =>
  x === null ? "—" : `${Math.round(x / 60000)} min`;

export function aiMetricsPage(opts: {
  metrics: AiMetrics;
  filter: { from: string; to: string; scenario: string };
}) {
  const m = opts.metrics;
  return html`
    <h2 class="mb-3 text-lg font-semibold text-slate-200">
      AI quality metrics <span class="text-xs font-normal text-slate-500">— on-demand projection, no metric tables</span>
    </h2>
    <form method="get" action="/admin/ai/metrics"
      class="mb-4 flex flex-wrap items-end gap-2 rounded-lg border border-slate-800 bg-slate-900 p-3 text-xs text-slate-400">
      <label>from <input name="from" value="${opts.filter.from}" placeholder="2026-01-01" class="${inputCls}" /></label>
      <label>to <input name="to" value="${opts.filter.to}" placeholder="2026-12-31" class="${inputCls}" /></label>
      <label>scenario <input name="scenario" value="${opts.filter.scenario}" placeholder="(all)" class="${inputCls}" /></label>
      <button type="submit" class="rounded bg-slate-700 px-3 py-1 text-xs text-slate-200 hover:bg-slate-600">Apply</button>
      <a href="/admin/ai" class="ml-auto text-slate-500 hover:text-slate-300">← policies</a>
    </form>

    <section class="mb-4 rounded-lg border border-slate-800 bg-slate-900 p-3">
      <h3 class="mb-2 text-xs font-semibold uppercase text-slate-500">Reviews (human side)</h3>
      ${kv("pending (triage + in review)", m.reviews.pending)}
      ${kv("decided in window", m.reviews.decided)}
      ${kv("reopened cases", m.reviews.reopened)}
      ${kv("avg review time (claim→decide)", ms(m.reviews.avgReviewMs))}
      ${Object.entries(m.reviews.byOperator)
        .sort((a, b) => b[1] - a[1])
        .map(([op, n]) => kv(`reviews by ${op}`, n))}
    </section>

    <section class="mb-4 rounded-lg border border-slate-800 bg-slate-900 p-3">
      <h3 class="mb-2 text-xs font-semibold uppercase text-slate-500">Human/AI agreement (shadow, blind)</h3>
      ${kv("compared runs", m.agreement.compared)}
      ${kv("agreed", m.agreement.agreed)}
      ${kv("shadow disagreements", m.agreement.disagreed)}
      ${kv("not comparable", m.agreement.notComparable)}
      ${kv("rejected AI suggestions (assist/supervised)", m.agreement.rejectedSuggestions)}
    </section>

    <section class="mb-4 rounded-lg border border-slate-800 bg-slate-900 p-3">
      <h3 class="mb-2 text-xs font-semibold uppercase text-slate-500">Linked decisions (aiRunRef)</h3>
      ${kv("decisions linked to runs", m.linkage.linked)}
      ${kv("false positives (AI approve → human reject/change)", m.linkage.falsePositives)}
      ${kv("false-positive rate", pct(m.linkage.falsePositiveRate))}
      <div class="flex gap-2">
        <span class="w-52 text-slate-500">Human Intervention Rate</span>
        <span class="font-mono text-slate-200">${pct(m.linkage.interventionRate)}</span>
        <span class="text-[10px] text-slate-600">directional — signal, not target · denominator: ${m.linkage.denominator} suggestions in play</span>
      </div>
    </section>
    ${m.truncated.runs || m.truncated.cases
      ? html`<p class="mb-4 text-[10px] text-amber-500/80">window truncated at scan cap — counts cover the most recent rows only${m.truncated.runs ? " (runs)" : ""}${m.truncated.cases ? " (cases)" : ""}</p>`
      : ""}

    <section class="rounded-lg border border-slate-800 bg-slate-900 p-3">
      <h3 class="mb-2 text-xs font-semibold uppercase text-slate-500">Runs by scenario × modeAtTime</h3>
      ${m.splits.length === 0
        ? html`<p class="text-xs text-slate-600">no runs in window</p>`
        : html`<table class="w-full border-collapse">
            <thead><tr>
              <th class="${th}">scenario</th><th class="${th}">modeAtTime</th>
              <th class="${th}">runs</th><th class="${th}">success</th>
              <th class="${th}">skipped</th><th class="${th}">error</th>
            </tr></thead>
            <tbody>
              ${m.splits.map(
                (s) => html`<tr class="border-t border-slate-800">
                  <td class="${td} font-mono">${s.scenario}</td>
                  <td class="${td} ${s.modeAtTime === "shadow" ? "text-amber-400" : ""}">${s.modeAtTime}</td>
                  <td class="${td}">${s.runs}</td>
                  <td class="${td}">${s.success}</td>
                  <td class="${td}">${s.skipped}</td>
                  <td class="${td}">${s.error}</td>
                </tr>`,
              )}
            </tbody>
          </table>`}
    </section>
  `;
}
