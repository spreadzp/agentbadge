// EPIC-262 (SLICE-262-11): S3 client monthly report — Read surface
// per DESIGN §4: hero-line slot, two scores + deltas, what-changed,
// details under signature, next-month. `prose` + print styles for
// PDF-via-browser-print. Status banner per lifecycle state.
import { html } from "hono/html";
import type { ClientReport } from "../../server/lib/intel/client-report";
import type { OperatorRole } from "../../server/lib/intel/registry";
import { IntegrityBlock, ScoreChip } from "./components";

const esc = (s: unknown) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const STATUS_CLS: Record<string, string> = {
  GENERATED: "bg-slate-800 text-slate-300",
  IN_REVIEW: "bg-sky-500/15 text-sky-300",
  APPROVED: "bg-amber-500/15 text-amber-300",
  SENT: "bg-emerald-500/15 text-emerald-300",
};

const deltaTxt = (d: number | null) =>
  d === null || d === 0 ? "±0" : `${d > 0 ? "+" : ""}${d}`;

export const IntelClientReportPage = (
  r: ClientReport,
  hostname: string | null,
  role: OperatorRole,
) => {
  const c = r.canonical;
  const canEdit = role !== "viewer" && r.status !== "SENT";
  const deltaItems = r.delta
    ? [
        ...r.delta.closedRuleIds.map((id) => ({ ok: true, txt: `resolved: ${id}` })),
        ...r.delta.newOpenRuleIds.map((id) => ({ ok: false, txt: `new: ${id}` })),
        ...(r.delta.transitions ?? []).map((t) => ({
          ok: false,
          txt: `${t.rule_id}: ${t.from} → ${t.to}`,
        })),
        ...(r.delta.stillOpenRuleIds ?? []).map((id) => ({ ok: false, txt: `still open: ${id}` })),
      ]
    : [];
  return html`
    <div class="mx-auto max-w-3xl py-8 print:py-0">
      <div class="print:hidden">
        <a href="/intel/sites/${r.siteId}" class="text-xs text-slate-500 hover:text-slate-300">← ${esc(hostname ?? "site")}</a>
      </div>

      <div class="mt-4 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <span class="rounded-full ${STATUS_CLS[r.status]} px-2.5 py-1 text-xs">${r.status}${r.sentAt ? ` · sent ${esc(r.sentAt.slice(0, 10))}` : ""}</span>
        <div class="flex gap-2">
          ${r.status !== "SENT" ? html`<a href="/intel/client-reports/${r.id}.md" class="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:border-slate-600">markdown</a>` : html`<a href="/intel/client-reports/${r.id}.md" class="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:border-slate-600">markdown</a>`}
          <button onclick="window.print()" class="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:border-slate-600">print / PDF</button>
          ${canEdit && r.status === "GENERATED" ? html`<form method="post" action="/intel/client-reports/${r.id}/review"><button class="rounded-lg bg-sky-600 px-3 py-1.5 text-xs text-white hover:bg-sky-500">mark in review</button></form>` : ""}
          ${canEdit && r.status === "IN_REVIEW" ? html`<form method="post" action="/intel/client-reports/${r.id}/approve"><button class="rounded-lg bg-amber-600 px-3 py-1.5 text-xs text-white hover:bg-amber-500">approve</button></form>` : ""}
          ${role !== "viewer" && r.status === "APPROVED" ? html`<form method="post" action="/intel/client-reports/${r.id}/send"><button class="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs text-white hover:bg-emerald-500">mark sent</button></form>` : ""}
        </div>
      </div>

      <article class="prose prose-invert mt-6 max-w-none">
        <h1 class="text-2xl font-bold text-white">Agent Surface Report — ${esc(hostname ?? r.siteId)}</h1>
        <p class="text-sm text-slate-500">${r.period} · generated ${esc(c.generatedAt)}</p>

        ${r.editorial.heroLine ? html`<p class="text-lg text-slate-200">${esc(r.editorial.heroLine)}</p>` : html`<p class="text-lg italic text-slate-500">Summary pending editorial review.</p>`}

        <div class="not-prose my-6 grid gap-4 sm:grid-cols-2">
          <div class="rounded-lg border border-slate-800 bg-slate-900/50 p-4">
            <p class="text-xs text-slate-500">Agent readiness <span class="text-slate-600">(higher is better)</span></p>
            <div class="mt-1 flex items-baseline gap-2">${ScoreChip("readiness", c.scores.readiness)}${r.delta ? html`<span class="text-sm ${r.delta.readinessDelta !== null && r.delta.readinessDelta > 0 ? "text-emerald-300" : "text-slate-400"}">${deltaTxt(r.delta.readinessDelta)}</span>` : html`<span class="text-xs text-slate-600">first period</span>`}</div>
          </div>
          <div class="rounded-lg border border-slate-800 bg-slate-900/50 p-4">
            <p class="text-xs text-slate-500">Surface exposure <span class="text-slate-600">(lower is better)</span></p>
            <div class="mt-1 flex items-baseline gap-2">${ScoreChip("exposure", c.scores.exposure)}${r.delta ? html`<span class="text-sm ${r.delta.exposureDelta !== null && r.delta.exposureDelta < 0 ? "text-emerald-300" : "text-slate-400"}">${deltaTxt(r.delta.exposureDelta)}</span>` : html`<span class="text-xs text-slate-600">first period</span>`}</div>
          </div>
        </div>

        ${r.editorial.whatChanged ? html`<h2 class="text-lg font-semibold text-white">What changed</h2><p class="whitespace-pre-line text-sm text-slate-300">${esc(r.editorial.whatChanged)}</p>` : ""}
        ${deltaItems.length > 0 ? html`<ul class="not-prose space-y-1 text-sm">${deltaItems.map((i) => html`<li class="${i.ok ? "text-emerald-300" : "text-amber-300"}">${i.ok ? "✔" : "⚠"} ${esc(i.txt)}</li>`)}</ul>` : ""}

        <h2 class="text-lg font-semibold text-white">Details</h2>
        <ul class="text-sm text-slate-300">
          <li>${c.findingCounts.fail} failing · ${c.findingCounts.warn} warnings · ${c.findingCounts.unknown} unknown · ${c.findingCounts.pass} passing checks</li>
          <li>${c.envelopeCount} evidence envelopes · ${Object.entries(c.provenance).map(([k, v]) => `${esc(k)} ${v}`).join(", ")}</li>
          <li>ruleset <code>${esc(c.ruleset.name)}@${esc(c.ruleset.version)}</code> · scan ${c.completeness}</li>
        </ul>

        <div class="not-prose">${IntegrityBlock({ integrity: { content_hash: c.contentHash, signature: { algorithm: "ed25519", key_id: c.keyId, value: "" } }, previous_hash: null, scan: { completeness: c.completeness } })}</div>

        ${r.editorial.nextMonth ? html`<h2 class="text-lg font-semibold text-white">Next month</h2><p class="whitespace-pre-line text-sm text-slate-300">${esc(r.editorial.nextMonth)}</p>` : ""}
      </article>

      ${canEdit ? html`
        <section class="mt-8 rounded-lg border border-slate-800 bg-slate-900/50 p-5 print:hidden">
          <h2 class="text-sm font-semibold text-white">Editorial layer <span class="ml-1 font-normal text-slate-500">v${r.editorial.version} — your words, not auto-generated</span></h2>
          <form method="post" action="/intel/client-reports/${r.id}/edit" class="mt-4 space-y-3">
            <label class="block"><span class="text-xs text-slate-500">Hero line — the one sentence the client reads first</span>
              <input name="heroLine" value="${esc(r.editorial.heroLine)}" class="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-emerald-500 focus:outline-none" /></label>
            <label class="block"><span class="text-xs text-slate-500">What changed — one item per line</span>
              <textarea name="whatChanged" rows="3" class="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-emerald-500 focus:outline-none">${esc(r.editorial.whatChanged)}</textarea></label>
            <label class="block"><span class="text-xs text-slate-500">Next month</span>
              <textarea name="nextMonth" rows="2" class="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-emerald-500 focus:outline-none">${esc(r.editorial.nextMonth)}</textarea></label>
            <label class="block"><span class="text-xs text-slate-500">Internal note — never rendered to the client page</span>
              <input name="internalNote" value="${esc(r.editorial.internalNote)}" class="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-emerald-500 focus:outline-none" /></label>
            <button class="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-400">Save editorial v${r.editorial.version + 1}</button>
          </form>
        </section>` : ""}
    </div>`;
};
