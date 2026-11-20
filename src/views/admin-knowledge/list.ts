/**
 * EPIC-229 (SLICE-229-9): Items list — operator queue table.
 * Pure SSR fragment; all cells escaped by hono/html.
 */

import { html } from "hono/html";

import type { KnowledgeItemRecord } from "../../server/lib/knowledge/types";
import { emptyMsg, fmtMs, tableShell, td } from "../finops/shared";
import {
  flashBanner,
  knowledgeNav,
  knowledgeShell,
  statusFilterBar,
  statusPill,
} from "./shared";

export interface ListRow {
  item: KnowledgeItemRecord;
  title: string | null;
  versions: number;
}

const row = (r: ListRow) => {
  const i = r.item;
  const updatedMs = Date.parse(i.updatedAt);
  return html`<tr>
    ${td(html`<a
      href="/admin/knowledge/${i.id}"
      class="text-emerald-400 hover:underline"
      >${i.slug}</a
    >`)}
    ${td(r.title ?? "—", false)}
    ${td(i.kind)}
    ${td(statusPill(i.status), false)}
    ${td(String(r.versions))}
    ${td(fmtMs(Number.isFinite(updatedMs) ? updatedMs : null))}
  </tr>`;
};

export function knowledgeListPage(input: {
  rows: ListRow[];
  status: string;
  flash?: { ok?: string; err?: string };
}): string {
  const body = html`
    ${flashBanner(input.flash ?? {})} ${statusFilterBar(input.status)}
    ${input.rows.length === 0
      ? emptyMsg("No knowledge items at this status.")
      : tableShell(
          ["slug", "title", "kind", "status", "versions", "updated"],
          html`${input.rows.map(row)}`,
        )}
    ${section("Create item", createForm())}
  `;
  return knowledgeShell(
    "Items",
    html`${knowledgeNav("items")}${body}`,
  ).toString();
}

const section = (title: string, body: unknown) => html`<div
  class="mt-5 rounded border border-slate-800 bg-slate-950/60 p-3"
>
  <h2 class="mb-2 text-sm font-semibold text-slate-300">${title}</h2>
  ${body}
</div>`;

const createForm = () => html`<form
    method="post"
    action="/admin/knowledge/create"
    class="flex flex-col gap-2"
  >
    <div class="flex flex-wrap gap-2">
      <input
        type="text"
        name="title"
        placeholder="title (required)"
        required
        class="w-72 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200"
      />
      <input
        type="text"
        name="slug"
        placeholder="slug (optional)"
        class="w-56 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200"
      />
      <select
        name="kind"
        class="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200"
      >
        ${["GUIDE", "CONCEPT", "FAQ", "POLICY", "CAPABILITY_DOC"].map(
          (k) => html`<option value="${k}">${k}</option>`,
        )}
      </select>
    </div>
    <textarea
      name="body"
      placeholder="body (required)"
      required
      rows="4"
      class="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200"
    ></textarea>
    <input
      type="text"
      name="summary"
      placeholder="summary (optional, ≤2000)"
      class="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200"
    />
    <div>
      <button
        type="submit"
        class="rounded bg-emerald-800 px-3 py-1 text-xs text-emerald-100 hover:bg-emerald-700"
        >Create draft</button
      >
    </div>
  </form>`;
