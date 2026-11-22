/**
 * EPIC-230 (SLICE-230-5, D-230-11): Review Center queue — one
 * inbox-style table per queue tab (feedback | reviews).
 */

import { html } from "hono/html";

import type { FeedbackRecord } from "../../server/lib/feedback/types";
import type { ReviewCaseRecord } from "../../server/lib/reviews/types";
import { emptyMsg, tableShell, td } from "../finops/shared";
import {
  fbPill,
  fmtIso,
  queueTabs,
  rcActorPill,
  reviewCenterShell,
  rvPill,
  statusBar,
} from "./shared";

const excerpt = (s: string, n = 120) =>
  s.length > n ? `${s.slice(0, n)}…` : s;

const fbRow = (r: FeedbackRecord) => html`<tr>
  ${td(html`<a
    href="/admin/review-center/feedback/${r.id}"
    class="text-emerald-400 hover:underline"
    >${r.id}</a
  >`)}
  ${td(fbPill(r.status), false)}
  ${td(rcActorPill(r.actorResolution), false)}
  ${td(r.kind ?? "—")}
  ${td(r.target ?? "—")}
  ${td(excerpt(r.text), false)}
  ${td(r.relatedCount > 1 ? `×${r.relatedCount}` : "—")}
  ${td(fmtIso(r.createdAt))}
</tr>`;

const rvRow = (r: ReviewCaseRecord) => html`<tr>
  ${td(html`<a
    href="/admin/review-center/reviews/${r.id}"
    class="text-emerald-400 hover:underline"
    >${r.id}</a
  >`)}
  ${td(rvPill(r.status), false)}
  ${td(r.reviewType)}
  ${td(rcActorPill(r.actorResolution), false)}
  ${td(r.assignee ?? "—")}
  ${td(r.reopenCount > 0 ? `×${r.reopenCount}` : "—")}
  ${td(fmtIso(r.createdAt))}
</tr>`;

export function feedbackQueuePage(input: {
  items: FeedbackRecord[];
  status: string;
  statuses: readonly string[];
  nextOffset: number | null;
  offset: number;
}): string {
  const body = html`
    ${queueTabs("feedback", input.status)}
    ${statusBar("feedback", input.statuses, input.status)}
    ${input.items.length === 0
      ? emptyMsg("Queue is empty — no feedback at this status.")
      : html`${tableShell(
          [
            "id",
            "status",
            "actor",
            "kind",
            "target",
            "text",
            "rel",
            "created",
          ],
          html`${input.items.map(fbRow)}`,
        )}
        ${input.nextOffset !== null || input.offset > 0
          ? html`<div class="mt-3 flex gap-3">
              ${input.offset > 0
                ? html`<a
                    href="/admin/review-center?queue=feedback&status=${input.status}&offset=${Math.max(0, input.offset - 50)}"
                    class="rounded bg-slate-800 px-3 py-1 text-xs text-slate-300 hover:text-slate-100"
                    >← Prev</a
                  >`
                : ""}
              ${input.nextOffset !== null
                ? html`<a
                    href="/admin/review-center?queue=feedback&status=${input.status}&offset=${input.nextOffset}"
                    class="rounded bg-slate-800 px-3 py-1 text-xs text-slate-300 hover:text-slate-100"
                    >Next →</a
                  >`
                : ""}
            </div>`
          : ""}`}
  `;
  return reviewCenterShell("Feedback queue", body).toString();
}

export function reviewsQueuePage(input: {
  items: ReviewCaseRecord[];
  status: string;
  statuses: readonly string[];
  nextOffset: number | null;
  offset: number;
}): string {
  const body = html`
    ${queueTabs("reviews", input.status)}
    ${statusBar("reviews", input.statuses, input.status)}
    ${input.items.length === 0
      ? emptyMsg("Queue is empty — no reviews at this status.")
      : html`${tableShell(
          ["id", "status", "type", "actor", "assignee", "reopened", "created"],
          html`${input.items.map(rvRow)}`,
        )}
        ${input.nextOffset !== null || input.offset > 0
          ? html`<div class="mt-3 flex gap-3">
              ${input.offset > 0
                ? html`<a
                    href="/admin/review-center?queue=reviews&status=${input.status}&offset=${Math.max(0, input.offset - 50)}"
                    class="rounded bg-slate-800 px-3 py-1 text-xs text-slate-300 hover:text-slate-100"
                    >← Prev</a
                  >`
                : ""}
              ${input.nextOffset !== null
                ? html`<a
                    href="/admin/review-center?queue=reviews&status=${input.status}&offset=${input.nextOffset}"
                    class="rounded bg-slate-800 px-3 py-1 text-xs text-slate-300 hover:text-slate-100"
                    >Next →</a
                  >`
                : ""}
            </div>`
          : ""}`}
  `;
  return reviewCenterShell("Reviews queue", body).toString();
}
