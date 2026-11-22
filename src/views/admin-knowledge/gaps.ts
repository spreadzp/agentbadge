/**
 * EPIC-229 (SLICE-229-9): gaps screen — the "repeated unanswered"
 * backlog (§17.2). OPEN gaps sortable by count, with
 * triage/resolve(link item)/wontfix form actions.
 */

import { html } from "hono/html";

import type {
  KnowledgeGapRecord,
  KnowledgeItemRecord,
} from "../../server/lib/knowledge/types";
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
  /** Arc R3 M-9: current page offset for the backlog pager. */
  offset?: number;
  flash?: { ok?: string; err?: string };
}

const actions = (g: KnowledgeGapRecord, items: KnowledgeItemRecord[]) => {
  if (g.status === "OPEN") {
    return html`<form
      method="post"
      action="/admin/knowledge/gaps/${g.id}/triage"
      class="inline"
    >
      ${tokenField()}
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
        ${tokenField()}
        <select
          name="linkedItemId"
          class="rounded border border-slate-700 bg-slate-900 px-1 py-0.5 text-[11px] text-slate-200"
        >
          ${items.map(
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
        ${tokenField()}
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

const gapFilterBar = (active: string) => {
  const items = ["OPEN", "TRIAGED", "RESOLVED", "WONTFIX", "all"];
  return html`<div class="mb-3 flex flex-wrap gap-1.5">
    ${items.map(
      (s) =>
        html`<a
          href="/admin/knowledge/gaps?status=${s}"
          class="rounded px-2.5 py-1 text-xs ${s === active
            ? "bg-emerald-900/60 text-emerald-300"
            : "bg-slate-800 text-slate-400 hover:text-slate-200"}"
          >${s}</a
        >`,
    )}
  </div>`;
};

const row = (g: KnowledgeGapRecord, items: KnowledgeItemRecord[]) => html`<tr>
  ${td(g.normalizedQuery, false)}
  ${td(String(g.count))}
  ${td(gapPill(g.status), false)}
  ${td(g.source)}
  ${td(g.lastSeenAt.slice(0, 19).replace("T", " "))}
  ${td(
    g.sampleQueries.length > 0
      ? html`<details class="text-[11px]">
          <summary class="cursor-pointer text-slate-400"
            >${g.sampleQueries.length} samples</summary
          >
          <ul class="mt-1 list-disc pl-4 text-slate-500">
            ${g.sampleQueries.map((s) => html`<li>${s}</li>`)}
          </ul>
        </details>`
      : "—",
    false,
  )}
  ${td(actions(g, items), false)}
</tr>`;

export function knowledgeGapsPage(input: GapsInput): string {
  const body = html`
    ${knowledgeNav("gaps")} ${flashBanner(input.flash ?? {})}
    ${gapFilterBar(input.status)}
    ${input.gaps.length === 0
      ? emptyMsg("No gaps at this status.")
      : tableShell(
          ["normalized query", "count", "status", "source", "last seen", "samples", "actions"],
          html`${input.gaps.map((g) => row(g, input.items))}`,
        )}
    ${(input.offset ?? 0) > 0 || input.gaps.length === 200
      ? html`<p class="mt-2 text-[11px]">
          ${(input.offset ?? 0) > 0
            ? html`<a
                href="/admin/knowledge/gaps?status=${input.status}&offset=${Math.max(0, (input.offset ?? 0) - 200)}"
                class="text-sky-400 hover:underline"
                >← prev page</a
              >`
            : ""}
          ${input.gaps.length === 200
            ? html`<a
                href="/admin/knowledge/gaps?status=${input.status}&offset=${(input.offset ?? 0) + 200}"
                class="ml-3 text-sky-400 hover:underline"
                >next page →</a
              >`
            : ""}
        </p>`
      : ""}
    <p class="mt-3 text-[11px] text-slate-500">
      Repeated unanswered agent queries land here (COMPOSER_REFUSAL
      from /ask, INTERACTION_SIGNAL from 228 classify, MANUAL).
      Resolving links the gap to the item that now covers it.
    </p>
  `;
  return knowledgeShell("Gaps", body).toString();
}
