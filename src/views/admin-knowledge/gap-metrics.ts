/**
 * EPIC-264 (SLICE-264-14): accountability metrics strip for the
 * gaps console — overdue / unassigned / breach total / clearance
 * times over a rolling window. Sibling of gaps.ts (300-line cap).
 * Numbers come from real COUNT(*) aggregates, not the page slice.
 */

import { html } from "hono/html";

import type { KnowledgeGapMetrics } from "../../server/lib/knowledge/gap-overdue";

const fmtDur = (sec: number | null) => {
  if (sec === null) return "—";
  const h = Math.floor(sec / 3600);
  const d = Math.floor(h / 24);
  return d > 0 ? `${d}d ${h % 24}h` : h > 0 ? `${h}h ${Math.floor((sec % 3600) / 60)}m` : `${Math.floor(sec / 60)}m`;
};

const cell = (label: string, value: string | number, warn = false) => html`
  <div class="px-3 py-2">
    <div class="text-[10px] uppercase tracking-wide text-slate-500">
      ${label}
    </div>
    <div
      class="text-sm font-medium ${warn ? "text-amber-400" : "text-slate-200"}"
    >
      ${value}
    </div>
  </div>
`;

/** Header band — same liveness rule as the OVERDUE badge; the
 *  breach total is durable history, not current state. */
export const gapMetricsStrip = (
  m: KnowledgeGapMetrics,
  windowDays: number,
) => html`
  <div
    class="mb-3 grid grid-cols-2 gap-px overflow-hidden rounded border border-slate-800 bg-slate-800 sm:grid-cols-5"
  >
    <div class="bg-slate-900">${cell("overdue", m.overdueCount, m.overdueCount > 0)}</div>
    <div class="bg-slate-900">${cell("unassigned", m.unassignedCount)}</div>
    <div class="bg-slate-900">${cell("breaches (all time)", m.breachesTotal)}</div>
    <div class="bg-slate-900">${cell(`cleared in ${windowDays}d`, m.resolvedInWindow)}</div>
    <div class="bg-slate-900">${cell(`avg / median clear`, `${fmtDur(m.timeToClearAvgSec)} / ${fmtDur(m.timeToClearMedianSec)}`)}</div>
  </div>
`;
