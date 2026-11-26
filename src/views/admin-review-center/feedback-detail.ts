/**
 * EPIC-230 (SLICE-230-5, D-230-11): Feedback detail — full record,
 * dictionary-field triage form, resolve/close actions, INTERNAL
 * timeline. Everything agent-supplied renders escaped.
 */

import { html } from "hono/html";

import type {
  FeedbackEventRecord,
  FeedbackRecord,
} from "../../server/lib/feedback/types";
import {
  FEEDBACK_KINDS,
  FEEDBACK_SEVERITIES,
  FEEDBACK_TARGETS,
} from "../../server/lib/feedback/types";
import type { AiSuggestionView } from "../../server/lib/ai/intake";
import { aiSuggestionSection } from "../admin-interactions/ai-suggestion";
import { emptyMsg, fmtMs, kv } from "../finops/shared";
import {
  fbPill,
  flashBanner,
  fmtIso,
  queueTabs,
  rcActorPill,
  reviewCenterShell,
  VIS_PILL,
} from "./shared";

const sel = (
  name: string,
  options: readonly string[],
  current: unknown,
) => html`<select
  name="${name}"
  class="mt-0.5 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm text-slate-200"
>
  <option value="">—</option>
  ${options.map(
    (o) =>
      html`<option value="${o}" ${o === current ? "selected" : ""}>${o}</option>`,
  )}
</select>`;

const inputCls =
  "mt-0.5 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm text-slate-200";

const formBtn = (label: string, cls = "") => html`<button
  type="submit"
  class="mt-2 rounded bg-emerald-800 px-3 py-1.5 text-sm text-emerald-100 hover:bg-emerald-700 ${cls}"
>
  ${label}
</button>`;

const tokenField = (token: string) =>
  html`<input type="hidden" name="formToken" value="${token}" />`;

function metaSection(r: FeedbackRecord) {
  return html`<section
      class="mb-4 rounded-lg border border-slate-800 bg-slate-900 p-3"
    >
      <h2 class="mb-2 text-sm font-semibold text-slate-200">
        ${fbPill(r.status)} ${r.id}
      </h2>
      ${kv("actor", html`${rcActorPill(r.actorResolution)} <span class="ml-1 font-mono text-slate-300">${r.actorRef ?? "—"}</span>`)}
      ${kv("kind", r.kind ?? "—")} ${kv("target", r.target ?? "—")}
      ${kv("severity", r.severity ?? "—")}
      ${kv("suggestion", r.suggestion ?? "—")}
      ${kv("relatedCount", r.relatedCount)}
      ${r.relatedFeedbackId
        ? kv(
            "canonical",
            html`<a
              href="/admin/review-center/feedback/${r.relatedFeedbackId}"
              class="font-mono text-emerald-400 hover:underline"
              >${r.relatedFeedbackId}</a
            >`,
          )
        : ""}
      ${kv("knowledgeConverted", r.knowledgeConverted ? "yes" : "no")}
      ${r.knowledgeItemId ? kv("knowledgeItem", r.knowledgeItemId) : ""}
      ${kv("created", fmtIso(r.createdAt))}
      ${kv("triaged", fmtIso(r.triagedAt))}
      ${kv("closed", fmtIso(r.closedAt))}
    </section>`;
}

function textSection(r: FeedbackRecord) {
  return html`<section
      class="mb-4 rounded-lg border border-slate-800 bg-slate-900 p-3"
    >
      <h3 class="mb-2 text-xs font-semibold uppercase text-slate-500">
        Feedback text
      </h3>
      <pre
        class="whitespace-pre-wrap break-words font-mono text-sm text-slate-200"
      >${r.text}</pre>
    </section>`;
}

function actionsSection(r: FeedbackRecord, token: string) {
  const base = `/admin/review-center/feedback/${r.id}`;
  if (r.status === "CLOSED") {
    return html`<p class="mb-4 text-sm text-slate-500">
      Terminal — no further actions.
    </p>`;
  }
  const triageForm =
    r.status === "RECEIVED"
      ? html`<section
          class="mb-4 rounded-lg border border-slate-800 bg-slate-900 p-3"
        >
          <h3 class="mb-2 text-xs font-semibold uppercase text-slate-500">
            Triage — set dictionary fields + verdict
          </h3>
          <form method="post" action="${base}/triage" class="space-y-2">
            ${tokenField(token)}
            <div class="grid grid-cols-3 gap-2">
              <label class="block text-xs text-slate-500"
                >kind ${sel("kind", FEEDBACK_KINDS, r.kind)}</label
              >
              <label class="block text-xs text-slate-500"
                >target ${sel("target", FEEDBACK_TARGETS, r.target)}</label
              >
              <label class="block text-xs text-slate-500"
                >severity ${sel("severity", FEEDBACK_SEVERITIES, r.severity)}</label
              >
            </div>
            <label class="block text-xs text-slate-500">
              suggestion (public verdict — agent sees this)
              <input name="suggestion" maxlength="1000" class="${inputCls}"
                value="${r.suggestion ?? ""}" />
            </label>
            ${formBtn("Triage →")}
          </form>
        </section>`
      : "";
  const resolveForm =
    r.status === "TRIAGED"
      ? html`<section
          class="mb-4 rounded-lg border border-slate-800 bg-slate-900 p-3"
        >
          <h3 class="mb-2 text-xs font-semibold uppercase text-slate-500">
            Resolve
          </h3>
          <form method="post" action="${base}/resolve" class="space-y-2">
            ${tokenField(token)}
            <label class="block text-xs text-slate-500">
              outcome ${sel("to", ["ACCEPTED", "DECLINED", "DUPLICATE"], "ACCEPTED")}
            </label>
            <label class="block text-xs text-slate-500">
              suggestion
              <input name="suggestion" maxlength="1000" class="${inputCls}"
                value="${r.suggestion ?? ""}" />
            </label>
            ${formBtn("Resolve →")}
          </form>
        </section>`
      : "";
  const closeForm =
    r.status === "ACCEPTED" ||
    r.status === "DECLINED" ||
    r.status === "DUPLICATE"
      ? html`<section
          class="mb-4 rounded-lg border border-slate-800 bg-slate-900 p-3"
        >
          <form method="post" action="${base}/close">
            ${tokenField(token)}
            <input type="hidden" name="fromStatus" value="${r.status}" />
            ${formBtn("Close →", "bg-slate-700 hover:bg-slate-600")}
          </form>
        </section>`
      : "";
  const convertForm =
    r.status === "ACCEPTED" && !r.knowledgeConverted
      ? html`<section
          class="mb-4 rounded-lg border border-slate-800 bg-slate-900 p-3"
        >
          <h3 class="mb-2 text-xs font-semibold uppercase text-slate-500">
            → Knowledge draft (creates a DRAFT — 229 approval stays human)
          </h3>
          <form method="post" action="${base}/convert">
            ${tokenField(token)} ${formBtn("Convert →")}
            <a
              href="${base}/draft.json"
              class="ml-3 text-xs text-slate-400 underline"
              >export draft JSON</a
            >
          </form>
        </section>`
      : "";
  return html`${triageForm} ${resolveForm} ${closeForm} ${convertForm}`;
}

function eventsSection(events: FeedbackEventRecord[]) {
  return html`<section
      class="rounded-lg border border-slate-800 bg-slate-900 p-3"
    >
      <h3 class="mb-2 text-xs font-semibold uppercase text-slate-500">
        Event log
      </h3>
      ${events.length === 0
        ? emptyMsg("No events.")
        : html`<ul class="space-y-1.5 text-xs">
            ${events.map(
              (e) => html`<li class="flex flex-wrap items-baseline gap-2">
                <span class="font-mono text-slate-500">#${e.seq}</span>
                ${html`<span
                  class="rounded px-1 py-0.5 text-[10px] ${VIS_PILL[e.visibility] ?? ""}"
                  >${e.visibility}</span
                >`}
                <span class="text-slate-300">${e.kind}</span>
                <span class="text-slate-500">${fmtMs(Date.parse(e.createdAt))}</span>
                <code class="break-all text-slate-400"
                  >${JSON.stringify(e.payload)}</code
                >
              </li>`,
            )}
          </ul>`}
    </section>`;
}

export function feedbackDetailPage(input: {
  record: FeedbackRecord;
  events: FeedbackEventRecord[];
  /** 232-6 E5: advisory extraction suggestions (advisory block). */
  aiSuggestions?: AiSuggestionView[];
  formToken: string;
  flash?: { ok?: string; err?: string };
}): string {
  const body = html`
    ${queueTabs("feedback", "all")} ${flashBanner(input.flash ?? {})}
    ${metaSection(input.record)} ${textSection(input.record)}
    ${aiSuggestionSection(input.aiSuggestions ?? [])}
    ${actionsSection(input.record, input.formToken)}
    ${eventsSection(input.events)}
  `;
  return reviewCenterShell(`Feedback ${input.record.id}`, body).toString();
}
