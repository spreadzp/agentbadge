/**
 * SLICE-226-3 — financial reports page.
 * ?format=csv on the same URL returns a CSV export (route layer).
 */

import { html } from "hono/html";

import type { FinReport } from "../../server/lib/finops/types";
import {
  finopsShell,
  fmtMs,
  tableShell,
  td,
} from "./shared";

const card = (label: string, value: string, hint = "") => html`
  <div class="rounded-lg border border-slate-800 bg-slate-900 p-3">
    <div class="text-[11px] uppercase tracking-wide text-slate-500">
      ${label}
    </div>
    <div class="mt-1 font-mono text-lg text-slate-100">${value}</div>
    ${hint ? html`<div class="text-[11px] text-slate-500">${hint}</div>` : ""}
  </div>
`;

const periodForm = (since: string, until: string) => html`
  <form method="get" class="mb-3 flex flex-wrap items-end gap-2 text-xs">
    <label class="text-slate-500"
      >Since (UTC)
      <input
        name="since"
        type="date"
        value="${since}"
        class="mt-0.5 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-slate-200"
    /></label>
    <label class="text-slate-500"
      >Until (UTC)
      <input
        name="until"
        type="date"
        value="${until}"
        class="mt-0.5 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-slate-200"
    /></label>
    <button
      type="submit"
      class="rounded bg-slate-700 px-3 py-1 text-slate-100 hover:bg-slate-600"
      >Apply</button
    >
  </form>
`;

const split = (title: string, m: Record<string, string>) =>
  Object.keys(m).length === 0
    ? ""
    : html`<div class="mb-4">
        <div class="mb-1 text-xs font-semibold uppercase text-slate-500">
          ${title}
        </div>
        ${tableShell(
          ["Key", "Gross"],
          Object.entries(m).map(
            ([k, v]) =>
              html`<tr>${td(k)}${td(v)}</tr>`,
          ),
        )}
      </div>`;

export const reportsPage = (
  rep: FinReport,
  qs: { since: string; until: string },
) =>
  finopsShell(
    "reports",
    html`
      ${periodForm(qs.since, qs.until)}
      <div class="mb-3 text-xs text-slate-500">
        Window: ${rep.period.sinceMs ? fmtMs(rep.period.sinceMs) : "—"} →
        ${rep.period.untilMs ? fmtMs(rep.period.untilMs) : "—"} ·
        <a
          href="/admin/finance/reports?format=csv${qs.since
            ? `&since=${qs.since}`
            : ""}${qs.until ? `&until=${qs.until}` : ""}"
          class="text-emerald-400 hover:underline"
          >Export CSV</a
        >
      </div>
      <div class="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        ${card("Gross volume", rep.grossVolume)}
        ${card("Net revenue", rep.netRevenue)}
        ${card("Refunds", rep.refundsTotal, `${rep.counts.refundedPayments} payments`)}
        ${card("Fees (est.)", rep.fees.total, rep.fees.basis)}
      </div>
      <div class="mb-4 grid gap-3 sm:grid-cols-2">
        ${card("Stripe fees (est.)", rep.fees.stripeEstimated)}
        ${card("Facilitator fees (est.)", rep.fees.facilitatorEstimated)}
      </div>
      ${split("By provider", rep.byProvider)}
      ${split("By product", rep.byProduct)}
      ${split("By network", rep.byNetwork)}
      <div class="rounded-lg border border-slate-800 bg-slate-900 p-3">
        <div class="text-[11px] uppercase tracking-wide text-slate-500">
          RECORD_ONLY mirrors — informational, excluded from revenue
        </div>
        <div class="mt-1 font-mono text-slate-200">
          ${rep.recordedOnly.count} rows · ${rep.recordedOnly.volume}
          ${rep.recordedOnly.currency}
        </div>
      </div>
    `,
  );
