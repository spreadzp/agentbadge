/**
 * EPIC-231 (SLICE-231-7): Opportunities tab — lifecycle board with
 * the operator actions: transition select (legal moves minus LINKED
 * — that one rides the «→ Backlog task» gesture) and an edit form
 * for title/hypothesis/expectedValue (declineReason on DECLINED).
 */

import { html } from "hono/html";

import type {
  DemandOpportunityRecord,
  DemandOpportunityStatus,
} from "../../server/lib/demand/types";
import {
  DEMAND_OPPORTUNITY_STATUSES,
  DEMAND_OPPORTUNITY_TRANSITIONS,
} from "../../server/lib/demand/types";
import { emptyMsg, fmtMs, tableShell, td } from "../finops/shared";
import {
  demandFilterBar,
  demandNav,
  demandShell,
  flashBanner,
  oppPill,
  tokenField,
} from "./shared";

const transitionForm = (o: DemandOpportunityRecord) => {
  const allowed = [
    ...DEMAND_OPPORTUNITY_TRANSITIONS[o.status as DemandOpportunityStatus],
  ].filter((s) => s !== "LINKED"); // LINKED rides «→ Backlog task» (231-8)
  const edit = html`<form
      method="post"
      action="/admin/demand/opportunities/${o.id}/edit"
      class="flex flex-wrap items-center gap-1"
    >
      ${tokenField()}
      <input
        type="text" name="title" placeholder="title" value="${o.title}"
        class="w-32 rounded border border-slate-700 bg-slate-900 px-1 py-0.5 text-[11px] text-slate-200"
      />
      <input
        type="text" name="hypothesis" placeholder="hypothesis"
        value="${o.hypothesis ?? ""}"
        class="w-40 rounded border border-slate-700 bg-slate-900 px-1 py-0.5 text-[11px] text-slate-200"
      />
      <input
        type="text" name="expectedValue" placeholder="expected value"
        value="${o.expectedValue ?? ""}"
        class="w-28 rounded border border-slate-700 bg-slate-900 px-1 py-0.5 text-[11px] text-slate-200"
      />
      <button
        type="submit"
        class="rounded bg-slate-700 px-2 py-0.5 text-[11px] text-slate-200 hover:bg-slate-600"
        >save</button
      >
    </form>`;
  const moves =
    allowed.length === 0
      ? html`<span class="text-slate-600">—</span>`
      : html`<form
          method="post"
          action="/admin/demand/opportunities/${o.id}/transition"
          class="flex flex-wrap items-center gap-1"
        >
          ${tokenField()}
          <select
            name="to"
            class="rounded border border-slate-700 bg-slate-900 px-1 py-0.5 text-[11px] text-slate-200"
          >
            ${allowed.map((s) => html`<option value="${s}">${s}</option>`)}
          </select>
          <input
            type="text" name="declineReason" placeholder="decline reason (if DECLINED)"
            class="w-36 rounded border border-slate-700 bg-slate-900 px-1 py-0.5 text-[11px] text-slate-200"
          />
          <button
            type="submit"
            class="rounded bg-sky-800 px-2 py-0.5 text-[11px] text-sky-100 hover:bg-sky-700"
            >move</button
          >
        </form>`;
  const link =
    o.status === "ACCEPTED"
      ? html`<form
          method="post"
          action="/admin/demand/opportunities/${o.id}/backlog"
        >
          ${tokenField()}
          <button
            type="submit"
            class="rounded bg-emerald-800 px-2 py-0.5 text-[11px] text-emerald-100 hover:bg-emerald-700"
            >→ Backlog task</button
          >
        </form>`
      : html``;
  return html`${moves}${link}${edit}`;
};

const row = (o: DemandOpportunityRecord) => {
  const created = Date.parse(o.createdAt);
  return html`<tr>
    ${td(html`<span class="font-mono text-[11px]" title="${o.clusterId}">${o.clusterId.slice(0, 14)}…</span>`, false)}
    ${td(o.title, false)}
    ${td(oppPill(o.status), false)}
    ${td(o.backlogTaskId ?? "—", false)}
    ${td(o.createdBy, false)}
    ${td(fmtMs(Number.isFinite(created) ? created : null))}
    ${td(transitionForm(o), false)}
  </tr>`;
};

export function demandOpportunitiesPage(input: {
  rows: DemandOpportunityRecord[];
  status: string;
  flash?: { ok?: string; err?: string };
}): string {
  const body = html`
    ${flashBanner(input.flash ?? {})}
    ${demandFilterBar(input.status, DEMAND_OPPORTUNITY_STATUSES, "/admin/demand/opportunities", "status")}
    ${input.rows.length === 0
      ? emptyMsg("No opportunities yet — «→ Opportunity» on a cluster drafts one.")
      : tableShell(
          ["cluster", "title", "status", "backlog", "created by", "created", "actions"],
          html`${input.rows.map(row)}`,
        )}
  `;
  return demandShell(
    "Opportunities",
    html`${demandNav("opportunities")}${body}`,
  ).toString();
}
