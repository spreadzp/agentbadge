/**
 * EPIC-231 (SLICE-231-6): Clusters tab — two top-N boards (by count
 * and by uniqueActors, §15 экран 3) + status/level filters and the
 * inline operator gestures (triage select, «→ Opportunity»).
 * Pure SSR fragment; all cells escaped by hono/html.
 */

import { html } from "hono/html";

import type {
  DemandClusterRecord,
  DemandClusterStatus,
} from "../../server/lib/demand/types";
import {
  DEMAND_CLUSTER_STATUSES,
  DEMAND_CLUSTER_TRANSITIONS,
  DEMAND_LEVELS,
} from "../../server/lib/demand/types";
import { emptyMsg, fmtMs, tableShell, td } from "../finops/shared";
import {
  clusterPill,
  demandFilterBar,
  demandNav,
  demandShell,
  flashBanner,
  levelPill,
  miniForm,
  textInput,
  tokenField,
} from "./shared";

const breakdown = (b: Record<string, number>) =>
  Object.entries(b)
    .map(([k, v]) => `${k}:${v}`)
    .join(" ");

const triageForm = (cl: DemandClusterRecord) => {
  const allowed = [
    ...DEMAND_CLUSTER_TRANSITIONS[cl.status as DemandClusterStatus],
  ];
  if (allowed.length === 0) return html`<span class="text-slate-600">—</span>`;
  return html`<form
      method="post"
      action="/admin/demand/clusters/${cl.id}/triage"
      class="flex flex-wrap items-center gap-1"
    >
      ${tokenField()}
      <select
        name="to"
        class="rounded border border-slate-700 bg-slate-900 px-1 py-0.5 text-[11px] text-slate-200"
      >
        ${allowed.map((s) => html`<option value="${s}">${s}</option>`)}
      </select>
      <button
        type="submit"
        class="rounded bg-sky-800 px-2 py-0.5 text-[11px] text-sky-100 hover:bg-sky-700"
        >triage</button
      >
    </form>`;
};

const opportunityForm = (cl: DemandClusterRecord) =>
  miniForm(
    `/admin/demand/clusters/${cl.id}/opportunity`,
    textInput("title", "title (default: cluster key)"),
    "→ Opportunity",
  );

const row = (cl: DemandClusterRecord) => {
  const lastSeen = Date.parse(cl.lastSeenAt);
  return html`<tr>
    ${td(
      html`<span class="font-mono text-[11px]">${cl.clusterKey}</span>`,
      false,
    )}
    ${td(cl.category ?? "—", false)}
    ${td(cl.feature ?? "—", false)}
    ${td(String(cl.count))}
    ${td(String(cl.uniqueActors))}
    ${td(levelPill(cl.level), false)}
    ${td(breakdown(cl.levelBreakdown), false)}
    ${td(clusterPill(cl.status), false)}
    ${td(fmtMs(Number.isFinite(lastSeen) ? lastSeen : null))}
    ${td(html`${triageForm(cl)}${opportunityForm(cl)}`, false)}
  </tr>`;
};

const board = (title: string, rows: DemandClusterRecord[]) => html`<div
  class="mb-5"
>
  <h2 class="mb-2 text-sm font-semibold text-slate-300">${title}</h2>
  ${rows.length === 0
    ? emptyMsg("No demand clusters here.")
    : tableShell(
        [
          "cluster",
          "category",
          "feature",
          "count",
          "actors",
          "level",
          "breakdown",
          "status",
          "last seen",
          "actions",
        ],
        html`${rows.map(row)}`,
      )}
</div>`;

export function demandClustersPage(input: {
  byCount: DemandClusterRecord[];
  byActors: DemandClusterRecord[];
  status: string;
  level: string;
  flash?: { ok?: string; err?: string };
}): string {
  const extra =
    `${input.level !== "all" ? `&level=${input.level}` : ""}` +
    `${input.status !== "all" ? `&status=${input.status}` : ""}`;
  const body = html`
    ${flashBanner(input.flash ?? {})}
    ${demandFilterBar(input.status, DEMAND_CLUSTER_STATUSES, "/admin/demand", "status", extra.replace(/&status=[^&]*/, ""))}
    ${demandFilterBar(input.level, DEMAND_LEVELS, "/admin/demand", "level", extra.replace(/&level=[^&]*/, ""))}
    ${board("Top by count", input.byCount)}
    ${board("Top by unique actors", input.byActors)}
  `;
  return demandShell(
    "Clusters",
    html`${demandNav("clusters")}${body}`,
  ).toString();
}
