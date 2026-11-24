/**
 * EPIC-264 (SLICE-264-12): gap detail — the audit feed (264-11
 * persisted rows: who/when/previous assignee) plus the due-change
 * form that owns the ONLY deadline path (reason required, C3).
 * Assign/reassign/due/unassign forms; lifecycle actions stay on
 * the backlog row.
 */

import { html } from "hono/html";

import type { KnowledgeGapEventRecord } from "../../server/lib/knowledge/gap-events";
import type {
  KnowledgeGapRecord,
  KnowledgeItemRecord,
} from "../../server/lib/knowledge/types";
import { isGapOverdue } from "../../server/lib/knowledge/gap-events";
import { tableShell, td } from "../finops/shared";
import {
  flashBanner,
  gapPill,
  knowledgeNav,
  knowledgeShell,
  tokenField,
} from "./shared";

export interface GapDetailInput {
  gap: KnowledgeGapRecord;
  events: KnowledgeGapEventRecord[];
  operators: { id: string; displayName: string }[];
  displayById: Record<string, string>;
  items: KnowledgeItemRecord[];
  flash?: { ok?: string; err?: string };
}

const fmt = (iso: string | null) =>
  iso === null ? "—" : iso.slice(0, 19).replace("T", " ");

const eventRow = (e: KnowledgeGapEventRecord, input: GapDetailInput) => {
  const name = (id: string | null) =>
    id === null ? "—" : (input.displayById[id] ?? id);
  return html`<tr>
    ${td(fmt(e.occurredAt))}
    ${td(e.kind)}
    ${td(e.actor === "system" ? "system" : name(e.actor))}
    ${td(name(e.previousAssignee))}
    ${td(name(e.assignedTo))}
    ${td(fmt(e.dueAt))}
    ${td(e.reason ?? "—")}
  </tr>`;
};

/** PRG keeps the operator on this detail page (the forms' `next`). */
const nextField = (id: string) =>
  html`<input type="hidden" name="next" value="/admin/knowledge/gaps/${id}" />`;

const assignForm = (input: GapDetailInput) => {
  const g = input.gap;
  const live = g.status === "OPEN" || g.status === "TRIAGED";
  if (!live && g.assignedTo === null) return "";
  return html`<div class="flex flex-wrap items-end gap-2">
    ${live
      ? html`<form
          method="post"
          action="/admin/knowledge/gaps/${g.id}/assign"
          class="flex flex-wrap items-end gap-2"
        >
          ${tokenField()}${nextField(g.id)}
          <label class="flex flex-col gap-0.5 text-[11px] text-slate-400">
            assignee
            <select
              name="assignedTo"
              class="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200"
            >
              <option value="">— pick operator —</option>
              ${input.operators.map(
                (o) =>
                  html`<option value="${o.id}" ${o.id === g.assignedTo ? "selected" : ""}
                    >${o.displayName}</option
                  >`,
              )}
            </select>
          </label>
          <label class="flex flex-col gap-0.5 text-[11px] text-slate-400">
            due (UTC, optional)
            <input
              type="datetime-local"
              name="dueAt"
              value="${g.dueAt?.slice(0, 16) ?? ""}"
              class="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200"
            />
          </label>
          <button
            type="submit"
            class="rounded bg-violet-800 px-3 py-1 text-xs text-violet-100 hover:bg-violet-700"
            >${g.assignedTo === null ? "assign" : "reassign"}</button
          >
        </form>
        <form
          method="post"
          action="/admin/knowledge/gaps/${g.id}/assign"
          class="inline"
        >
          ${tokenField()}${nextField(g.id)}
          <input type="hidden" name="claim" value="1" />
          <button
            type="submit"
            class="rounded bg-violet-900/60 px-3 py-1 text-xs text-violet-200 hover:bg-violet-800"
            >claim for me</button
          >
        </form>`
      : ""}
    ${g.assignedTo !== null
      ? html`<form
          method="post"
          action="/admin/knowledge/gaps/${g.id}/unassign"
          class="inline"
        >
          ${tokenField()}${nextField(g.id)}
          <button
            type="submit"
            class="rounded bg-slate-800 px-3 py-1 text-xs text-slate-300 hover:text-slate-100"
            >unassign (keeps deadline)</button
          >
        </form>`
      : ""}
  </div>`;
};

const dueForm = (input: GapDetailInput) => html`<form
  method="post"
  action="/admin/knowledge/gaps/${input.gap.id}/due"
  class="flex flex-wrap items-end gap-2"
>
  ${tokenField()}${nextField(input.gap.id)}
  <label class="flex flex-col gap-0.5 text-[11px] text-slate-400">
    due (UTC — blank clears)
    <input
      type="datetime-local"
      name="dueAt"
      value="${input.gap.dueAt?.slice(0, 16) ?? ""}"
      class="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200"
    />
  </label>
  <label class="flex flex-col gap-0.5 text-[11px] text-slate-400">
    reason (required — the audit row carries it)
    <input
      type="text"
      name="reason"
      placeholder="why the deadline moves"
      class="w-56 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200"
    />
  </label>
  <button
    type="submit"
    class="rounded bg-amber-800 px-3 py-1 text-xs text-amber-100 hover:bg-amber-700"
    >set / clear due</button
  >
</form>`;

export function knowledgeGapDetailPage(input: GapDetailInput): string {
  const g = input.gap;
  const now = new Date().toISOString();
  const overdue = isGapOverdue(g, now);
  const body = html`
    ${knowledgeNav("gaps")} ${flashBanner(input.flash ?? {})}
    <p class="mb-3 text-xs">
      <a href="/admin/knowledge/gaps" class="text-sky-400 hover:underline"
        >← back to gaps</a
      >
    </p>
    <h2 class="mb-2 text-lg font-medium text-slate-100">${g.normalizedQuery}</h2>
    <div class="mb-4 flex flex-wrap gap-3 text-xs text-slate-300">
      ${gapPill(g.status)}
      <span>count ${g.count}</span>
      <span>source ${g.source}</span>
      <span
        >owner
        ${g.assignedTo === null
          ? "—"
          : (input.displayById[g.assignedTo] ?? g.assignedTo)}</span
      >
      <span
        >due ${fmt(g.dueAt)}${overdue
          ? html`<span
              class="ml-1 rounded bg-red-900/60 px-1.5 py-0.5 text-[10px] font-semibold text-red-200"
              >OVERDUE</span
            >`
          : ""}</span
      >
      <span>last seen ${fmt(g.lastSeenAt)}</span>
      ${g.linkedItemId !== null
        ? html`<span
            >→
            <a
              href="/admin/knowledge/${g.linkedItemId}"
              class="text-emerald-400 hover:underline"
              >${g.linkedItemId}</a
            ></span
          >`
        : ""}
    </div>
    <h3 class="mt-4 mb-2 text-sm font-semibold text-slate-300">ownership</h3>
    ${assignForm(input)}
    <h3 class="mt-4 mb-2 text-sm font-semibold text-slate-300">deadline</h3>
    ${dueForm(input)}
    <h3 class="mt-4 mb-2 text-sm font-semibold text-slate-300">
      audit feed (append-only)
    </h3>
    ${input.events.length === 0
      ? html`<p class="text-xs text-slate-500">No events yet.</p>`
      : tableShell(
          ["when (UTC)", "kind", "actor", "was", "now", "due", "reason"],
          html`${input.events.map((e) => eventRow(e, input))}`,
        )}
    <h3 class="mt-4 mb-2 text-sm font-semibold text-slate-300">samples</h3>
    <ul class="list-disc pl-5 text-xs text-slate-400">
      ${g.sampleQueries.map((s) => html`<li>${s}</li>`)}
    </ul>
  `;
  return knowledgeShell("Gap detail", body).toString();
}
