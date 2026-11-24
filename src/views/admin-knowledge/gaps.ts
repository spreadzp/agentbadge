/**
 * EPIC-229 (SLICE-229-9): gaps screen — the "repeated unanswered"
 * backlog (§17.2). SLICE-264-12: the queue is managed from here —
 * owner + due/OVERDUE badge (derived: dueAt<now && the gap still
 * needs work), per-row assign/claim/unassign forms, the
 * unassigned-pool filter; the audit feed lives on gap detail.
 */

import { html } from "hono/html";

import type {
  KnowledgeGapRecord,
  KnowledgeItemRecord,
} from "../../server/lib/knowledge/types";
import { isGapOverdue } from "../../server/lib/knowledge/gap-events";
import { emptyMsg, tableShell, td } from "../finops/shared";
import {
  flashBanner,
  gapPill,
  knowledgeNav,
  knowledgeShell,
  tokenField,
} from "./shared";

export interface GapsInput {
  gaps: KnowledgeGapRecord[];
  status: string;
  items: KnowledgeItemRecord[];
  /** Active human operators for the assignee select (D-264-Q8 —
   *  service/break_glass principals can't own backlog work). */
  operators: { id: string; displayName: string }[];
  /** operatorId → displayName for the owner column. */
  displayById: Record<string, string>;
  /** PRG target for the row forms — the current filtered URL so a
   *  mutation lands back on the same view (status/pool/offset). */
  next: string;
  /** "none" → the unassigned pick-up pool is filtered in. */
  assigned: string;
  /** Arc R3 M-9: current page offset for the backlog pager. */
  offset?: number;
  flash?: { ok?: string; err?: string };
}

/** PRG keeps the operator on the filtered view they came from. */
const nextField = (v: string) =>
  html`<input type="hidden" name="next" value="${v}" />`;

const lifecycleActions = (
  g: KnowledgeGapRecord,
  input: GapsInput,
) => {
  if (g.status === "OPEN") {
    return html`<form
      method="post"
      action="/admin/knowledge/gaps/${g.id}/triage"
      class="inline"
    >
      ${tokenField()}${nextField(input.next)}
      <button
        type="submit"
        class="rounded bg-sky-800 px-2 py-0.5 text-[11px] text-sky-100 hover:bg-sky-700"
        >triage</button
      >
    </form>`;
  }
  if (g.status === "TRIAGED") {
    return html`<span class="inline-flex items-center gap-1">
      <form
        method="post"
        action="/admin/knowledge/gaps/${g.id}/resolve"
        class="inline-flex items-center gap-1"
      >
        ${tokenField()}${nextField(input.next)}
        <select
          name="linkedItemId"
          class="rounded border border-slate-700 bg-slate-900 px-1 py-0.5 text-[11px] text-slate-200"
        >
          ${input.items.map(
            (it) => html`<option value="${it.id}">${it.slug}</option>`,
          )}
        </select>
        <button
          type="submit"
          class="rounded bg-emerald-800 px-2 py-0.5 text-[11px] text-emerald-100 hover:bg-emerald-700"
          >resolve</button
        >
      </form>
      <form
        method="post"
        action="/admin/knowledge/gaps/${g.id}/wontfix"
        class="inline"
      >
        ${tokenField()}${nextField(input.next)}
        <button
          type="submit"
          class="rounded bg-slate-800 px-2 py-0.5 text-[11px] text-slate-300 hover:text-slate-100"
          >wontfix</button
        >
      </form>
    </span>`;
  }
  return g.linkedItemId
    ? html`<a
        href="/admin/knowledge/${g.linkedItemId}"
        class="text-[11px] text-emerald-400 hover:underline"
        >${g.linkedItemId}</a
      >`
    : "—";
};

/** Assignee select + claim/unassign — OPEN/TRIAGED only (terminal
 *  rows take no new owner; their unassign lives on the detail
 *  page). dueAt is optional on assign; once set it moves only via
 *  the detail form WITH a reason (C3 — "dueAt не сбрасывается"). */
const ownershipActions = (
  g: KnowledgeGapRecord,
  input: GapsInput,
) => {
  if (g.status !== "OPEN" && g.status !== "TRIAGED") {
    return html`<a
      href="/admin/knowledge/gaps/${g.id}"
      class="text-[11px] text-sky-400 hover:underline"
      >detail</a
    >`;
  }
  return html`<span class="inline-flex flex-wrap items-center gap-1">
    <form
      method="post"
      action="/admin/knowledge/gaps/${g.id}/assign"
      class="inline-flex items-center gap-1"
    >
      ${tokenField()}${nextField(input.next)}
      <select
        name="assignedTo"
        class="max-w-[110px] rounded border border-slate-700 bg-slate-900 px-1 py-0.5 text-[11px] text-slate-200"
      >
        <option value="">— assignee —</option>
        ${input.operators.map(
          (o) =>
            html`<option value="${o.id}" ${o.id === g.assignedTo ? "selected" : ""}
              >${o.displayName}</option
            >`,
        )}
      </select>
      <input
        type="datetime-local"
        name="dueAt"
        title="due (UTC)"
        class="rounded border border-slate-700 bg-slate-900 px-1 py-0.5 text-[11px] text-slate-200"
      />
      <button
        type="submit"
        class="rounded bg-violet-800 px-2 py-0.5 text-[11px] text-violet-100 hover:bg-violet-700"
        >${g.assignedTo === null ? "assign" : "reassign"}</button
      >
    </form>
    <form
      method="post"
      action="/admin/knowledge/gaps/${g.id}/assign"
      class="inline"
    >
      ${tokenField()}${nextField(input.next)}
      <input type="hidden" name="claim" value="1" />
      <button
        type="submit"
        title="assign to me"
        class="rounded bg-violet-900/60 px-2 py-0.5 text-[11px] text-violet-200 hover:bg-violet-800"
        >claim</button
      >
    </form>
    ${g.assignedTo !== null
      ? html`<form
          method="post"
          action="/admin/knowledge/gaps/${g.id}/unassign"
          class="inline"
        >
          ${tokenField()}${nextField(input.next)}
          <button
            type="submit"
            title="drop assignee — deadline survives"
            class="rounded bg-slate-800 px-2 py-0.5 text-[11px] text-slate-300 hover:text-slate-100"
            >unassign</button
          >
        </form>`
      : ""}
    <a
      href="/admin/knowledge/gaps/${g.id}"
      class="text-[11px] text-sky-400 hover:underline"
      >detail</a
    >
  </span>`;
};

const ownerCell = (g: KnowledgeGapRecord, input: GapsInput) =>
  g.assignedTo === null
    ? td(html`<span class="text-slate-500">—</span>`, false)
    : td(input.displayById[g.assignedTo] ?? g.assignedTo);

const dueCell = (g: KnowledgeGapRecord, now: string) => {
  if (g.dueAt === null) return td("—");
  const stamp = g.dueAt.slice(0, 16).replace("T", " ");
  return td(
    isGapOverdue(g, now)
      ? html`<span class="text-red-300">${stamp}</span>
          <span
            class="ml-1 rounded bg-red-900/60 px-1.5 py-0.5 text-[10px] font-semibold text-red-200"
            >OVERDUE</span
          >`
      : stamp,
    false,
  );
};

const gapFilterBar = (input: GapsInput) => {
  const items = ["OPEN", "TRIAGED", "RESOLVED", "WONTFIX", "all"];
  const qs = (s: string) =>
    `/admin/knowledge/gaps?status=${s}${input.assigned === "none" ? "&assigned=none" : ""}`;
  return html`<div class="mb-3 flex flex-wrap items-center gap-1.5">
    ${items.map(
      (s) =>
        html`<a
          href="${qs(s)}"
          class="rounded px-2.5 py-1 text-xs ${s === input.status
            ? "bg-emerald-900/60 text-emerald-300"
            : "bg-slate-800 text-slate-400 hover:text-slate-200"}"
          >${s}</a
        >`,
    )}
    <a
      href="/admin/knowledge/gaps?status=${input.status}${input.assigned === "none" ? "" : "&assigned=none"}"
      class="rounded px-2.5 py-1 text-xs ${input.assigned === "none"
        ? "bg-violet-900/60 text-violet-300"
        : "bg-slate-800 text-slate-400 hover:text-slate-200"}"
      >unassigned pool</a
    >
  </div>`;
};

const row = (
  g: KnowledgeGapRecord,
  input: GapsInput,
  now: string,
) => html`<tr>
  ${td(g.normalizedQuery, false)}
  ${td(String(g.count))}
  ${td(gapPill(g.status), false)}
  ${ownerCell(g, input)}
  ${dueCell(g, now)}
  ${td(g.source)}
  ${td(g.lastSeenAt.slice(0, 19).replace("T", " "))}
  ${td(
    html`<span class="inline-flex flex-col gap-1">
      ${lifecycleActions(g, input)} ${ownershipActions(g, input)}
    </span>`,
    false,
  )}
</tr>`;

export function knowledgeGapsPage(input: GapsInput): string {
  const now = new Date().toISOString();
  const body = html`
    ${knowledgeNav("gaps")} ${flashBanner(input.flash ?? {})}
    ${gapFilterBar(input)}
    ${input.gaps.length === 0
      ? emptyMsg("No gaps at this status.")
      : tableShell(
          ["normalized query", "count", "status", "owner", "due (UTC)", "source", "last seen", "actions"],
          html`${input.gaps.map((g) => row(g, input, now))}`,
        )}
    ${(input.offset ?? 0) > 0 || input.gaps.length === 200
      ? html`<p class="mt-2 text-[11px]">
          ${(input.offset ?? 0) > 0
            ? html`<a
                href="/admin/knowledge/gaps?status=${input.status}&offset=${Math.max(0, (input.offset ?? 0) - 200)}${input.assigned === "none" ? "&assigned=none" : ""}"
                class="text-sky-400 hover:underline"
                >← prev page</a
              >`
            : ""}
          ${input.gaps.length === 200
            ? html`<a
                href="/admin/knowledge/gaps?status=${input.status}&offset=${(input.offset ?? 0) + 200}${input.assigned === "none" ? "&assigned=none" : ""}"
                class="ml-3 text-sky-400 hover:underline"
                >next page →</a
              >`
            : ""}
        </p>`
      : ""}
    <p class="mt-3 text-[11px] text-slate-500">
      Repeated unanswered agent queries land here (COMPOSER_REFUSAL
      from /ask, INTERACTION_SIGNAL from 228 classify, MANUAL).
      Sorted overdue-first — a deadline counts only while the gap
      still needs work. Reassign/unassign never reset the deadline;
      it moves only on the detail page, with a reason.
    </p>
  `;
  return knowledgeShell("Gaps", body).toString();
}
