/**
 * SLICE-226-3 — payments list page + HTMX table fragment.
 * `GET /admin/finance/payments` returns the full page on direct
 * access and only the table for HTMX requests (wrapFragment).
 */

import { html } from "hono/html";

import type {
  PaymentListFilter,
  PaymentListResult,
} from "../../server/lib/finops/types";
import {
  emptyMsg,
  finopsShell,
  fmtMs,
  statusPill,
  tableShell,
  td,
} from "./shared";

export const TABLE_ID = "finops-payments-table";

/** Filters bar — GET form swapped into the table slot via HTMX. */
const filtersBar = (f: PaymentListFilter) => html`
  <form
    hx-get="/admin/finance/payments"
    hx-target="#${TABLE_ID}"
    hx-swap="innerHTML"
    class="mb-3 flex flex-wrap items-end gap-2 text-xs"
  >
    <label class="text-slate-500"
      >Provider
      <input
        name="provider"
        value="${f.provider ?? ""}"
        placeholder="STRIPE|DIRECT_USDC|X402"
        class="mt-0.5 w-40 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-slate-200"
    /></label>
    <label class="text-slate-500"
      >Status
      <input
        name="status"
        value="${f.status ?? ""}"
        placeholder="CONFIRMED"
        class="mt-0.5 w-32 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-slate-200"
    /></label>
    <label class="text-slate-500"
      >Product
      <input
        name="productId"
        value="${f.productId ?? ""}"
        class="mt-0.5 w-32 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-slate-200"
    /></label>
    <label class="text-slate-500"
      >Since (UTC)
      <input
        name="since"
        type="date"
        class="mt-0.5 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-slate-200"
    /></label>
    <label class="text-slate-500"
      >Until (UTC)
      <input
        name="until"
        type="date"
        class="mt-0.5 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-slate-200"
    /></label>
    <button
      type="submit"
      class="rounded bg-slate-700 px-3 py-1 text-slate-100 hover:bg-slate-600"
      >Filter</button
    >
  </form>
`;

/** Table fragment — what HTMX swaps on filter/page changes. */
export const paymentsTable = (r: PaymentListResult) => {
  if (r.items.length === 0) return emptyMsg("No payments match the filters.");
  const qs = (page: number) => `?page=${page}`;
  return html`<div id="${TABLE_ID}">
    ${tableShell(
      ["Reference", "Status", "Amount", "Provider", "Network", "Product", "Created"],
      r.items.map(
        (p) => html`<tr class="hover:bg-slate-800/60">
          ${td(
            html`<a
              href="/admin/finance/payments/${p.id}"
              class="text-emerald-400 hover:underline"
              >${p.reference}</a
            >`,
          )}
          ${td(statusPill(p.status), false)}
          ${td(`${p.amount} ${p.currency}`)}
          ${td(p.provider ?? "—")}
          ${td(p.network ?? "—")}
          ${td(p.productId ?? "—")}
          ${td(fmtMs(p.createdAtMs))}
        </tr>`,
      ),
    )}
    <div class="mt-2 flex items-center gap-3 text-xs text-slate-500">
      <span>Page ${r.page} (${r.items.length} rows)</span>
      ${r.page > 1
        ? html`<a
            href="/admin/finance/payments${qs(r.page - 1)}"
            class="text-emerald-400 hover:underline"
            >← prev</a
          >`
        : ""}
      ${r.hasMore
        ? html`<a
            href="/admin/finance/payments${qs(r.page + 1)}"
            class="text-emerald-400 hover:underline"
            >next →</a
          >`
        : ""}
    </div>
  </div>`;
};

export const paymentsPage = (
  result: PaymentListResult,
  filters: PaymentListFilter,
) => finopsShell("payments", html`${filtersBar(filters)}${paymentsTable(result)}`);
