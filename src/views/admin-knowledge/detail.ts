/**
 * EPIC-229 (SLICE-229-9): item detail — metadata, status scale,
 * workflow action buttons (only legal transitions rendered),
 * versions list with restore. Taxonomy sections (capabilities /
 * relations / evidence / edit form) live in detail-taxonomy.ts —
 * 300-line guard.
 */

import { html } from "hono/html";

import type {
  KnowledgeItemRecord,
  KnowledgeStatusEventRecord,
  KnowledgeVersionRecord,
} from "../../server/lib/knowledge/types";
import { emptyMsg, fmtMs, kv, tableShell, td } from "../finops/shared";
import {
  flashBanner,
  knowledgeNav,
  knowledgeShell,
  statusPill,
  tokenField,
} from "./shared";

export interface DetailInput {
  item: KnowledgeItemRecord;
  latest: KnowledgeVersionRecord | null;
  published: KnowledgeVersionRecord | null;
  versions: KnowledgeVersionRecord[];
  events: KnowledgeStatusEventRecord[];
  allowedTransitions: string[];
  taxonomy: unknown; // pre-rendered fragment (detail-taxonomy.ts)
  flash?: { ok?: string; err?: string };
}

const ACTION_LABEL: Record<string, string> = {
  PENDING: "Submit for review",
  VERIFIED: "Verify",
  DRAFT: "Reject → draft",
  PUBLISHED: "Publish",
  WITHDRAWN: "Withdraw",
};

const section = (title: string, body: unknown) => html`<div
  class="mt-5 rounded border border-slate-800 bg-slate-950/60 p-3"
>
  <h2 class="mb-2 text-sm font-semibold text-slate-300">${title}</h2>
  ${body}
</div>`;

const transitionButtons = (
  item: KnowledgeItemRecord,
  allowed: string[],
) => {
  if (allowed.length === 0) {
    return html`<p class="text-xs text-slate-500">
      Terminal status — no transitions.
    </p>`;
  }
  return html`<div class="flex flex-wrap items-center gap-2">
    ${allowed.map(
      (to) => html`<form
        method="post"
        action="/admin/knowledge/${item.id}/transition"
        class="flex items-center gap-1"
      >
        ${tokenField()}
        <input type="hidden" name="to" value="${to}" />
        <input
          type="hidden"
          name="expectedVersionId"
          value="${item.latestVersionId}"
        />
        <input
          type="text"
          name="operator"
          placeholder="operator"
          class="w-24 rounded border border-slate-700 bg-slate-900 px-1.5 py-0.5 text-[11px] text-slate-300"
        />
        <button
          type="submit"
          class="rounded px-3 py-1 text-xs ${to === "WITHDRAWN" || to === "DRAFT"
            ? "bg-red-900/70 text-red-200 hover:bg-red-800"
            : "bg-emerald-800 text-emerald-100 hover:bg-emerald-700"}"
          >${ACTION_LABEL[to] ?? to}</button
        >
      </form>`,
    )}
  </div>`;
};

const versionRow = (
  item: KnowledgeItemRecord,
  v: KnowledgeVersionRecord,
) => {
  const isLatest = v.id === item.latestVersionId;
  const isPublished = v.id === item.publishedVersionId;
  const restorable = item.status === "DRAFT" && !isLatest;
  return html`<tr>
    ${td(`v${v.seq}`)}
    ${td(v.title, false)}
    ${td(v.createdBy)}
    ${td(fmtMs(Date.parse(v.createdAt)))}
    ${td(
      html`${isLatest
          ? html`<span class="mr-1 rounded bg-sky-900/60 px-1.5 py-0.5 text-[11px] text-sky-300"
              >latest</span
            >`
          : ""}${isPublished
          ? html`<span class="rounded bg-emerald-900/60 px-1.5 py-0.5 text-[11px] text-emerald-300"
              >published</span
            >`
          : ""}`,
      false,
    )}
    ${td(
      restorable
        ? html`<form method="post" action="/admin/knowledge/${item.id}/restore">
            ${tokenField()}
            <input type="hidden" name="seq" value="${v.seq}" />
            <button
              type="submit"
              class="rounded bg-slate-800 px-2 py-0.5 text-[11px] text-slate-300 hover:text-slate-100"
              >restore</button
            >
          </form>`
        : "",
      false,
    )}
  </tr>`;
};

export function knowledgeDetailPage(input: DetailInput): string {
  const i = input.item;
  const body = html`
    ${knowledgeNav("items")} ${flashBanner(input.flash ?? {})}
    ${section(
      "Item",
      html`<div class="grid grid-cols-2 gap-x-6 gap-y-1 text-xs">
        ${kv("slug", i.slug)} ${kv("kind", i.kind)}
        ${kv("status", statusPill(i.status))}
        ${kv("id", i.id)} ${kv("createdBy", i.createdBy)}
        ${kv("created", fmtMs(Date.parse(i.createdAt)))}
      </div>
      <div class="mt-2 text-xs text-slate-400">
        latest version:
        ${input.latest ? `v${input.latest.seq} — ${input.latest.title}` : "—"}
        <br />published version:
        ${input.published
          ? `v${input.published.seq} — ${input.published.title}`
          : "none"}
      </div>`,
    )}
    ${section("Workflow", transitionButtons(i, input.allowedTransitions))}
    ${section(
      "Latest version preview",
      input.latest
        ? html`<div class="text-xs">
            <p class="mb-1 font-medium text-slate-200">
              ${input.latest.title}
            </p>
            ${input.latest.summary
              ? html`<p class="mb-2 text-slate-400">
                  ${input.latest.summary}
                </p>`
              : ""}
            <pre
              class="max-h-64 overflow-auto whitespace-pre-wrap rounded bg-slate-900 p-2 text-[11px] text-slate-300"
              >${input.latest.body}</pre
            >
          </div>`
        : emptyMsg("No versions yet."),
    )}
    ${section(
      "Versions",
      input.versions.length === 0
        ? emptyMsg("None.")
        : tableShell(
            ["seq", "title", "by", "at", "marks", ""],
            html`${input.versions.map((v) => versionRow(i, v))}`,
          ),
    )}
    ${section(
      "Status events",
      input.events.length === 0
        ? emptyMsg("None.")
        : tableShell(
            ["from", "to", "actor", "reason", "at"],
            html`${input.events.map(
              (e) => html`<tr>
                ${td(e.from ?? "—")} ${td(e.to)} ${td(e.actor)}
                ${td(e.reason ?? "—", false)} ${td(fmtMs(Date.parse(e.createdAt)))}
              </tr>`,
            )}`,
          ),
    )}
    ${input.taxonomy}
  `;
  return knowledgeShell(`Item ${i.slug}`, body).toString();
}
