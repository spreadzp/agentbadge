/**
 * SLICE-226-3 — admin audit trail page (AdminAction list).
 */

import { html } from "hono/html";

import type { AdminActionRow } from "../../server/lib/finops/types";

import {
  emptyMsg,
  finopsShell,
  tableShell,
  td,
} from "./shared";

const filtersBar = (f: {
  action?: string;
  subjectType?: string;
  operator?: string;
}) => html`
  <form method="get" class="mb-3 flex flex-wrap items-end gap-2 text-xs">
    <label class="text-slate-500"
      >Action
      <input
        name="action"
        value="${f.action ?? ""}"
        placeholder="REVIEW|REFUND|…"
        class="mt-0.5 w-44 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-slate-200"
    /></label>
    <label class="text-slate-500"
      >Subject type
      <input
        name="subjectType"
        value="${f.subjectType ?? ""}"
        placeholder="payment"
        class="mt-0.5 w-32 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-slate-200"
    /></label>
    <label class="text-slate-500"
      >Operator
      <input
        name="operator"
        value="${f.operator ?? ""}"
        class="mt-0.5 w-32 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-slate-200"
    /></label>
    <button
      type="submit"
      class="rounded bg-slate-700 px-3 py-1 text-slate-100 hover:bg-slate-600"
      >Filter</button
    >
  </form>
`;

export const auditPage = (
  rows: AdminActionRow[],
  filters: { action?: string; subjectType?: string; operator?: string },
) =>
  finopsShell(
    "audit",
    html`
      ${filtersBar(filters)}
      ${rows.length === 0
        ? emptyMsg("No admin actions recorded yet.")
        : tableShell(
            ["Action", "Subject", "Operator", "Evidence", "At"],
            rows.map(
              (a) => html`<tr class="hover:bg-slate-800/60">
                ${td(a.action)}
                ${td(`${a.subjectType}:${a.subjectId}`)}
                ${td(a.principalId ?? a.operator)}
                ${td(
                  a.evidence
                    ? html`<code class="text-[11px]"
                        >${JSON.stringify(a.evidence).slice(0, 80)}</code
                      >`
                    : "—",
                )}
                ${td(a.createdAt)}
              </tr>`,
            ),
          )}
    `,
  );
