/**
 * EPIC-228 (SLICE-228-5): Request Detail — full record, session
 * thread, classification + respond/reject forms, internal timeline.
 * Everything agent-supplied renders escaped (hono/html default).
 */

import { html } from "hono/html";

import type { InboxRequestRecord } from "../../server/lib/request-inbox/types";
import type {
  InteractionEventRecord,
  InteractionResponseRecord,
} from "../../server/lib/request-inbox/interaction-types";
import { statusOfState } from "../../server/lib/request-inbox/interaction-types";
import {
  INTERACTION_INTENTS,
  INTERACTION_SIGNAL_TYPES,
  type ClassifyInput,
} from "../../server/lib/agent-interaction";
import type { AiSuggestionView } from "../../server/lib/ai/intake";
import { fmtMs, kv } from "../finops/shared";
import { aiSuggestionSection } from "./ai-suggestion";
import {
  actorPill,
  flashBanner,
  interactionPill,
  interactionShell,
  VIS_PILL,
} from "./shared";

export interface DetailData {
  request: InboxRequestRecord;
  classification: ClassifyInput & { classifiedBy?: string | null };
  responses: InteractionResponseRecord[];
  events: InteractionEventRecord[];
  thread: { id: string; status: string; kind: string | null; excerpt: string; createdAtMs: number }[];
  sessionRequestCount: number | null;
  /** EPIC-232 (§16.5): advisory AI runs — display-only block. */
  aiSuggestions?: AiSuggestionView[];
  flash?: { ok?: string; err?: string };
}

const textOf = (r: InboxRequestRecord): string => {
  const p = r.payload;
  if (p && typeof p === "object") {
    const t = (p as Record<string, unknown>).text;
    if (typeof t === "string") return t;
  }
  return typeof p === "string" ? p : JSON.stringify(p);
};

const terminalBadge = (r: InboxRequestRecord) =>
  ["completed", "failed"].includes(r.state)
    ? html`<span
        class="ml-2 rounded bg-slate-800 px-2 py-0.5 text-[11px] text-slate-400"
        >terminal — mutations refuse</span
      >`
    : "";

function metaSection(d: DetailData) {
  const r = d.request;
  return html`<section
      class="mb-4 rounded-lg border border-slate-800 bg-slate-900 p-3"
    >
      <h2 class="mb-2 text-sm font-semibold text-slate-200">
        ${interactionPill(statusOfState(r.state))} ${r.id}${terminalBadge(r)}
      </h2>
      ${kv("kind", r.kind ?? "—")} ${kv("actor", html`${actorPill(r.actorResolution)} <span class="ml-1 font-mono text-slate-300">${r.actorRef ?? "—"}</span>`)}
      ${kv("sessionId", r.sessionId ?? "—")} ${kv("channel", r.channel ?? "—")}
      ${kv("created", fmtMs(r.createdAtMs))}
      ${kv("responded", fmtMs(r.respondedAtMs))}
      ${d.sessionRequestCount !== null
        ? kv("session touches", d.sessionRequestCount)
        : ""}
    </section>`;
}

function payloadSection(d: DetailData) {
  return html`<section
      class="mb-4 rounded-lg border border-slate-800 bg-slate-900 p-3"
    >
      <h3 class="mb-2 text-xs font-semibold uppercase text-slate-500">
        Original payload
      </h3>
      <pre
        class="whitespace-pre-wrap break-words font-mono text-sm text-slate-200"
      >${textOf(d.request)}</pre>
    </section>`;
}

function threadSection(d: DetailData) {
  if (d.thread.length <= 1) return "";
  return html`<section
      class="mb-4 rounded-lg border border-slate-800 bg-slate-900 p-3"
    >
      <h3 class="mb-2 text-xs font-semibold uppercase text-slate-500">
        Session thread — ${d.thread.length} requests
      </h3>
      <ul class="space-y-1 text-sm">
        ${d.thread.map(
          (t) => html`<li>
            <a href="/admin/interactions/${t.id}" class="font-mono text-emerald-400 hover:underline">${t.id}</a>
            ${interactionPill(t.status)}
            <span class="text-slate-400">${t.excerpt}</span>
          </li>`,
        )}
      </ul>
    </section>`;
}

function classifySection(d: DetailData) {
  const c = d.classification;
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
  const csv = (v: unknown) =>
    Array.isArray(v) ? (v as unknown[]).join(", ") : "";
  const listField = (name: string, label: string, current: unknown) =>
    html`<label class="block text-xs text-slate-500">
      ${label}
      <input
        name="${name}"
        value="${csv(current)}"
        placeholder="comma-separated"
        class="mt-0.5 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm text-slate-200"
      />
    </label>`;
  return html`<section
      class="mb-4 rounded-lg border border-slate-800 bg-slate-900 p-3"
    >
      <h3 class="mb-2 text-xs font-semibold uppercase text-slate-500">
        Classification ${c.classifiedBy ? html`<span class="normal-case text-slate-400">by ${c.classifiedBy}</span>` : ""}
      </h3>
      <form method="post" action="/admin/interactions/${d.request.id}/classify" class="grid grid-cols-1 gap-3 md:grid-cols-3">
        <label class="block text-xs text-slate-500">intent
          ${sel("intent", INTERACTION_INTENTS, c.intent)}</label>
        <label class="block text-xs text-slate-500">signalType
          ${sel("signalType", INTERACTION_SIGNAL_TYPES, c.signalType)}</label>
        <label class="block text-xs text-slate-500">outcome
          <input name="outcome" maxlength="512" value="${c.outcome ?? ""}"
            class="mt-0.5 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm text-slate-200" /></label>
        ${listField("topics", "topics", c.topics)}
        ${listField("entities", "entities", c.entities)}
        ${listField("demandSignals", "demandSignals", c.demandSignals)}
        <label class="flex items-center gap-2 text-xs text-slate-400">
          <input type="hidden" name="knowledgeGap_present" value="1" />
          <input type="checkbox" name="knowledgeGap" value="1"
            ${c.knowledgeGap === true ? "checked" : ""}
            class="rounded border-slate-700 bg-slate-900" />
          knowledge gap — answer not in the knowledge base
        </label>
        <div class="flex items-end gap-2">
          <button type="submit"
            class="rounded bg-sky-700 px-3 py-1 text-xs font-medium text-sky-50 hover:bg-sky-600">Classify</button>
        </div>
      </form>
    </section>`;
}

function respondRejectSection(d: DetailData) {
  const id = d.request.id;
  return html`<section class="mb-4 grid grid-cols-1 gap-3 md:grid-cols-2">
    <form method="post" action="/admin/interactions/${id}/respond"
      class="rounded-lg border border-slate-800 bg-slate-900 p-3">
      <h3 class="mb-2 text-xs font-semibold uppercase text-slate-500">Respond</h3>
      <textarea name="body" required rows="4" maxlength="16384"
        class="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-200"
        placeholder="Answer visible to the agent via the public poll"></textarea>
      <div class="mt-2 flex items-end gap-2">
        <button type="submit"
          class="rounded bg-emerald-700 px-3 py-1 text-xs font-medium text-emerald-50 hover:bg-emerald-600">Send answer</button>
      </div>
    </form>
    <form method="post" action="/admin/interactions/${id}/reject"
      class="rounded-lg border border-slate-800 bg-slate-900 p-3">
      <h3 class="mb-2 text-xs font-semibold uppercase text-slate-500">Reject</h3>
      <input name="reason" maxlength="512" placeholder="internal reason (not public)"
        class="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-200" />
      <div class="mt-2 flex items-end gap-2">
        <button type="submit"
          class="rounded bg-red-800 px-3 py-1 text-xs font-medium text-red-100 hover:bg-red-700">Reject</button>
      </div>
    </form>
  </section>`;
}

function responsesSection(d: DetailData) {
  if (d.responses.length === 0) return "";
  return html`<section class="mb-4 rounded-lg border border-slate-800 bg-slate-900 p-3">
    <h3 class="mb-2 text-xs font-semibold uppercase text-slate-500">Responses</h3>
    ${d.responses.map(
      (r) => html`<div class="mb-2 rounded border border-slate-800 bg-slate-950 p-2">
        <div class="mb-1 text-[11px] text-slate-500">
          ${r.operatorRef} · ${fmtMs(r.createdAtMs)} · ${r.id}
        </div>
        <pre class="whitespace-pre-wrap break-words text-sm text-slate-200">${r.body}</pre>
      </div>`,
    )}
  </section>`;
}

function eventsSection(d: DetailData) {
  if (d.events.length === 0) return "";
  return html`<section class="rounded-lg border border-slate-800 bg-slate-900 p-3">
    <h3 class="mb-2 text-xs font-semibold uppercase text-slate-500">
      Event log (${d.events.length})
    </h3>
    <ol class="space-y-1.5 text-sm">
      ${d.events.map(
        (e) => html`<li class="flex flex-wrap items-baseline gap-2">
          <span class="text-[11px] text-slate-500">#${e.seq} ${fmtMs(e.createdAtMs)}</span>
          <span class="rounded px-1 text-[11px] ${VIS_PILL[e.visibility] ?? "bg-slate-800 text-slate-400"}">${e.visibility}</span>
          <span class="font-mono text-slate-300">${e.kind}</span>
          <code class="max-w-xl break-all text-[11px] text-slate-500">${JSON.stringify(e.payload)}</code>
        </li>`,
      )}
    </ol>
  </section>`;
}

export function detailPage(d: DetailData): string {
  const body = html`
    ${flashBanner(d.flash ?? {})}
    <a href="/admin/interactions" class="mb-3 inline-block text-xs text-slate-500 hover:text-slate-300">← Inbox</a>
    ${metaSection(d)} ${payloadSection(d)} ${threadSection(d)}
    ${classifySection(d)} ${aiSuggestionSection(d.aiSuggestions ?? [])}
    ${respondRejectSection(d)}
    ${responsesSection(d)} ${eventsSection(d)}
  `;
  return interactionShell(`Request ${d.request.id}`, body).toString();
}
