/**
 * SLICE-226-3 — reconciliation exceptions queue page.
 * OPEN rows show an inline resolve form (operator + resolution).
 */

import { html } from "hono/html";

import type { ReconciliationExceptionRow } from "@agentbadge/database";

import {
  emptyMsg,
  finopsShell,
  fmtMs,
  statusPill,
} from "./shared";

const RES = "finops-exc-result";

const resolutions = [
  "MATCHED",
  "IGNORED",
  "MANUAL_ADJUSTED",
  "REFUNDED",
];

const resolveForm = (row: ReconciliationExceptionRow) => html`
  <form
    hx-post="/admin/finance/exceptions/${row.id}/resolve"
    hx-target="#${RES}"
    hx-swap="innerHTML"
    class="mt-2 flex flex-wrap items-end gap-2 border-t border-slate-800 pt-2"
  >
    <input
      name="operator"
      required
      placeholder="operator *"
      class="w-36 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200"
    />
    <select
      name="resolution"
      class="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200"
    >
      ${resolutions.map((r) => html`<option value="${r}">${r}</option>`)}
    </select>
    <input
      name="note"
      placeholder="note"
      class="min-w-40 flex-1 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200"
    />
    <button
      type="submit"
      class="rounded bg-emerald-700 px-3 py-1 text-xs text-emerald-50 hover:bg-emerald-600"
      >Resolve</button
    >
  </form>
`;

const card = (row: ReconciliationExceptionRow) => html`
  <div class="mb-2 rounded-lg border border-slate-800 bg-slate-900 p-3">
    <div class="flex flex-wrap items-center gap-3 text-sm">
      ${statusPill(row.status)}
      <span class="font-mono text-amber-300">${row.type}</span>
      <span class="font-mono text-slate-300">${row.subjectRef}</span>
      <span class="ml-auto text-xs text-slate-500"
        >${fmtMs(row.createdAtMs)}</span
      >
    </div>
    ${row.details
      ? html`<pre
          class="mt-2 max-h-24 overflow-auto rounded bg-slate-950/60 p-2 text-[11px] text-slate-400"
          >${JSON.stringify(row.details, null, 2)}</pre
        >`
      : ""}
    ${row.status === "OPEN"
      ? resolveForm(row)
      : html`<div class="mt-2 text-xs text-slate-500">
          ${row.resolution} by ${row.resolvedBy}
          ${row.resolvedAtMs ? `· ${fmtMs(row.resolvedAtMs)}` : ""}
        </div>`}
  </div>
`;

export const exceptionsPage = (rows: ReconciliationExceptionRow[]) =>
  finopsShell(
    "exceptions",
    html`
      <form
        hx-post="/admin/finance/exceptions/detect"
        hx-target="#${RES}"
        hx-swap="innerHTML"
        class="mb-3 flex items-end gap-2"
      >
        <input
          name="operator"
          required
          placeholder="operator *"
          class="w-44 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200"
        />
        <button
          type="submit"
          class="rounded bg-slate-700 px-3 py-1 text-xs text-slate-100 hover:bg-slate-600"
          >Scan for exceptions</button
        >
      </form>
      <div id="${RES}"></div>
      ${rows.length === 0
        ? emptyMsg("No exceptions in the queue.")
        : html`<div>${rows.map((r) => card(r))}</div>`}
    `,
  );
