/**
 * EPIC-228 (SLICE-228-5): Inbox — operator queue table.
 * Pure SSR fragment; all cells are escaped by hono/html.
 */

import { html } from "hono/html";

import type { InboxRequestRecord } from "../../server/lib/request-inbox/types";
import { statusOfState } from "../../server/lib/request-inbox/interaction-types";
import { emptyMsg, fmtMs, tableShell, td } from "../finops/shared";
import {
  actorPill,
  flashBanner,
  interactionPill,
  interactionShell,
  statusFilterBar,
} from "./shared";

export interface InboxItem {
  record: InboxRequestRecord;
  excerpt: string;
}

const row = (item: InboxItem) => {
  const r = item.record;
  const ageMin = Math.max(0, Math.floor((Date.now() - r.createdAtMs) / 60000));
  return html`<tr>
    ${td(html`<a
      href="/admin/interactions/${r.id}"
      class="text-emerald-400 hover:underline"
      >${r.id}</a
    >`)}
    ${td(interactionPill(statusOfState(r.state)), false)}
    ${td(actorPill(r.actorResolution), false)}
    ${td(r.intent ?? "—")}
    ${td(item.excerpt, false)}
    ${td(`${ageMin}m`)}
    ${td(fmtMs(r.createdAtMs))}
  </tr>`;
};

export function inboxPage(input: {
  items: InboxItem[];
  status: string;
  nextCursor: string | null;
  flash?: { ok?: string; err?: string };
}): string {
  const body = html`
    ${flashBanner(input.flash ?? {})} ${statusFilterBar(input.status)}
    ${input.items.length === 0
      ? emptyMsg("Queue is empty — no interactions at this status.")
      : html`${tableShell(
          ["id", "status", "actor", "intent", "excerpt", "age", "created"],
          html`${input.items.map(row)}`,
        )}
        ${input.nextCursor
          ? html`<div class="mt-3">
              <a
                href="/admin/interactions?status=${input.status}&cursor=${input.nextCursor}"
                class="rounded bg-slate-800 px-3 py-1 text-xs text-slate-300 hover:text-slate-100"
                >Next page →</a
              >
            </div>`
          : ""}`}
  `;
  return interactionShell("Inbox", body).toString();
}
