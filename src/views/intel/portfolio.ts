// EPIC-262 (SLICE-262-10): S2 portfolio — attention-sorted site
// rows, separate scores, honest empty states (DESIGN §3).
import { html } from "hono/html";
import type { PortfolioRow } from "../../server/lib/intel/dashboard/data";
import {
  FreshnessCell,
  JobStateChip,
  ScoreChip,
} from "./components";

const esc = (s: unknown) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// attention-first sort (DESIGN §3): exposure fail → no data → stale
export function attentionSort(rows: PortfolioRow[]): PortfolioRow[] {
  const score = (r: PortfolioRow) => {
    const j = r.latestJob;
    if (!j) return 0; // never scanned — most urgent
    if (j.status === "failed") return 0.5;
    const ex = j.report?.scores.exposure;
    const fails = ex ? ex.evaluable - ex.pass : 0;
    return fails > 0 ? 100 + fails : j.status === "partial" ? 50 : 10;
  };
  return [...rows].sort((a, b) => score(b) - score(a));
}

export const IntelPortfolioPage = (rows: PortfolioRow[]) => {
  const sorted = attentionSort(rows);
  const needsAttention = sorted.filter((r) => {
    const ex = r.latestJob?.report?.scores.exposure;
    return !r.latestJob || r.latestJob.status === "failed" || r.latestJob.status === "partial" || (ex && ex.evaluable - ex.pass > 0);
  });
  return html`
    <div class="mx-auto max-w-6xl py-8">
      <div class="flex items-center justify-between">
        <div>
          <h1 class="text-2xl font-bold text-white">Agent Surface Intel</h1>
          <p class="mt-1 text-sm text-slate-400">${rows.length} site${rows.length === 1 ? "" : "s"} · ${needsAttention.length} need attention</p>
        </div>
        <form method="post" action="/intel/logout">
          <button class="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-400 hover:border-slate-600">Sign out</button>
        </form>
      </div>

      ${needsAttention.length > 0 ? html`
        <p class="mt-6 rounded-lg border border-amber-800/50 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          ${needsAttention.length} site${needsAttention.length === 1 ? "" : "s"} need attention — exposure findings, missing scans or stale data.
        </p>` : ""}

      <div class="mt-6 overflow-hidden rounded-lg border border-slate-800">
        ${rows.length === 0 ? html`
          <div class="p-12 text-center">
            <p class="text-sm font-medium text-slate-300">No sites yet</p>
            <p class="mt-2 text-xs text-slate-500">Sites appear here after the registry onboards them — connect the WordPress plugin to verify installation and grant audit consent.</p>
          </div>` : html`
          <table class="min-w-full text-sm">
            <thead>
              <tr class="bg-slate-800/70 text-left text-slate-300">
                <th class="px-4 py-3 font-medium">Site</th>
                <th class="px-4 py-3 font-medium">Readiness</th>
                <th class="px-4 py-3 font-medium">Exposure</th>
                <th class="px-4 py-3 font-medium">Last scan</th>
                <th class="px-4 py-3 font-medium">Job</th>
                <th class="px-4 py-3 font-medium">Consent</th>
              </tr>
            </thead>
            <tbody>
              ${sorted.map((r) => {
                const rep = r.latestJob?.report;
                return html`<tr class="border-t border-slate-800 bg-slate-900/40">
                  <td class="px-4 py-3">
                    <a href="/intel/sites/${r.site.id}" class="font-medium text-slate-100 hover:text-emerald-300">${esc(r.hostname ?? r.site.id)}</a>
                    <p class="text-xs text-slate-500">${r.site.environment} · ${r.site.status}</p>
                  </td>
                  <td class="px-4 py-3">${ScoreChip("readiness", rep?.scores.readiness?.score ?? null)}</td>
                  <td class="px-4 py-3">${ScoreChip("exposure", rep?.scores.exposure?.score ?? null)}</td>
                  <td class="px-4 py-3">${FreshnessCell(rep?.evidence.received_at_max ?? null)}</td>
                  <td class="px-4 py-3">${r.latestJob ? JobStateChip(r.latestJob.status) : html`<span class="rounded-full bg-slate-800 px-2 py-0.5 text-xs text-slate-400">no scan</span>`}</td>
                  <td class="px-4 py-3"><span class="rounded-full ${{ granted: "bg-emerald-500/15 text-emerald-300", revoked: "bg-rose-500/15 text-rose-300", none: "bg-slate-800 text-slate-400" }[r.consent]} px-2 py-0.5 text-xs">${r.consent === "none" ? "no consent" : r.consent}</span></td>
                </tr>`;
              })}
            </tbody>
          </table>`}
      </div>
    </div>`;
};
