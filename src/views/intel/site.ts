// EPIC-262 (SLICE-262-10): S2 site detail — the reference screen
// from wireframes/s2-site-detail.html: ownership + consent chips,
// two scores, findings with provenance, integrity block.
import { html } from "hono/html";
import type { SiteDetail } from "../../server/lib/intel/dashboard/data";
import type { OperatorRole } from "../../server/lib/intel/registry";
import type { ClientReport } from "../../server/lib/intel/client-report";
import {
  ConsentBadge,
  ConsentPanel,
  type EvidenceProvenanceMap,
  FindingRow,
  FreshnessCell,
  IntegrityBlock,
  JobStateChip,
  OwnershipBadge,
  ScoreChip,
} from "./components";

const esc = (s: unknown) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export const IntelSitePage = (
  d: SiteDetail,
  role: OperatorRole,
  clientReports: ClientReport[] = [],
  err?: string,
) => {
  const rep = d.latestJob?.report ?? null;
  const findings = rep?.findings ?? [];
  const fails = findings.filter((f) => f.status === "fail");
  const unknowns = findings.filter((f) => f.status === "unknown");
  const prov: EvidenceProvenanceMap = Object.fromEntries(
    d.evidence.map((e) => [e.id, e.provenance]),
  );
  const canScan = role !== "viewer";
  return html`
    <div class="mx-auto max-w-5xl py-8">
      <a href="/intel" class="text-xs text-slate-500 hover:text-slate-300">← portfolio</a>

      <div class="mt-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 class="text-2xl font-bold text-white">${esc(d.primaryHostname ?? d.site.id)}</h1>
          <p class="mt-1 text-sm text-slate-400">${d.site.environment} · ${d.domains.length} domain${d.domains.length === 1 ? "" : "s"} · <span class="font-mono text-xs">${d.site.id}</span></p>
        </div>
        ${canScan ? html`
          <form method="post" action="/intel/sites/${d.site.id}/scan">
            <button class="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-400" ${d.latestJob?.status === "queued" || d.latestJob?.status === "running" ? "disabled" : ""}>Run scan</button>
          </form>` : html`<span class="rounded-lg bg-slate-800 px-4 py-2 text-sm text-slate-500" title="viewers cannot run scans">view-only</span>`}
      </div>

      ${err ? html`<p class="mt-4 rounded-lg bg-rose-500/15 px-4 py-3 text-sm text-rose-300">${err}</p>` : ""}

      <div class="mt-5 flex flex-wrap items-center gap-2">
        ${OwnershipBadge("installation_control", d.ownership.installation_control)}
        ${OwnershipBadge("domain_control", d.ownership.domain_control)}
        ${ConsentBadge(d.consents)}
        ${d.latestJob ? JobStateChip(d.latestJob.status) : html`<span class="rounded-full bg-slate-800 px-2.5 py-1 text-xs text-slate-400">no scan yet</span>`}
      </div>

      ${ConsentPanel(d.site.id, d.consents, d.consentEvents, role !== "viewer")}

      ${!rep ? html`
        <section class="mt-8 rounded-lg border border-slate-800 bg-slate-900/50 p-8 text-center">
          <p class="text-sm font-medium text-slate-300">No scan data yet</p>
          <p class="mt-2 text-xs text-slate-500">${d.latestJob?.status === "running" || d.latestJob?.status === "queued" ? "A scan is in progress — the report appears here when it finishes." : d.latestJob?.status === "failed" ? `The last scan failed${d.latestJob.error ? `: ${esc(d.latestJob.error)}` : "."}` : "Run a scan to produce a signed agent-surface report."}</p>
        </section>` : html`
        <section class="mt-8 grid gap-4 sm:grid-cols-4">
          <div class="rounded-lg border border-slate-800 bg-slate-900/50 p-4">
            <p class="text-xs text-slate-500">Agent readiness</p>
            <div class="mt-1">${ScoreChip("readiness", rep.scores.readiness.score)}</div>
            <p class="mt-1 text-xs text-slate-500">${rep.scores.readiness.pass}/${rep.scores.readiness.evaluable} checks pass</p>
          </div>
          <div class="rounded-lg border border-slate-800 bg-slate-900/50 p-4">
            <p class="text-xs text-slate-500">Surface exposure</p>
            <div class="mt-1">${ScoreChip("exposure", rep.scores.exposure.score)}</div>
            <p class="mt-1 text-xs text-slate-500">${rep.scores.exposure.fail}/${rep.scores.exposure.evaluable} exposed</p>
          </div>
          <div class="rounded-lg border border-slate-800 bg-slate-900/50 p-4">
            <p class="text-xs text-slate-500">Evidence freshness</p>
            <div class="mt-1 text-lg font-bold">${FreshnessCell(rep.evidence.received_at_max)}</div>
            <p class="mt-1 text-xs text-slate-500">${rep.evidence.envelope_count} envelope${rep.evidence.envelope_count === 1 ? "" : "s"}</p>
          </div>
          <div class="rounded-lg border border-slate-800 bg-slate-900/50 p-4">
            <p class="text-xs text-slate-500">Findings</p>
            <p class="mt-1 text-lg font-bold text-slate-100">${fails.length} <span class="text-sm font-normal text-rose-300">fail</span> · ${unknowns.length} <span class="text-sm font-normal text-slate-500">unknown</span></p>
            <p class="mt-1 text-xs text-slate-500">${findings.length} checks</p>
          </div>
        </section>

        ${d.momDelta ? html`
          <p class="mt-4 text-xs text-slate-500">
            vs previous scan:
            ${d.momDelta.readinessDelta !== null ? html` readiness <span class="${d.momDelta.readinessDelta > 0 ? "text-emerald-300" : d.momDelta.readinessDelta < 0 ? "text-rose-300" : "text-slate-400"}">${d.momDelta.readinessDelta > 0 ? "+" : ""}${d.momDelta.readinessDelta}</span> ·` : ""}
            ${d.momDelta.exposureDelta !== null ? html` exposure <span class="${d.momDelta.exposureDelta < 0 ? "text-emerald-300" : d.momDelta.exposureDelta > 0 ? "text-rose-300" : "text-slate-400"}">${d.momDelta.exposureDelta > 0 ? "+" : ""}${d.momDelta.exposureDelta}</span> ·` : ""}
            ${d.momDelta.closed.length} resolved · ${d.momDelta.newOpen.length} new · ${d.momDelta.stillOpen.length} still open
          </p>` : ""}

        <div class="mt-8 grid gap-6 lg:grid-cols-3">
          <section class="rounded-lg border border-slate-800 bg-slate-900/50 p-5 lg:col-span-2">
            <h2 class="text-sm font-semibold text-white">Findings <span class="ml-1 font-normal text-slate-500">${findings.length} checks — fails and unknowns first</span></h2>
            <ul class="divide-y divide-slate-800/60">
              ${[...findings].sort((a, b) => (a.status === "fail" ? 0 : a.status === "unknown" ? 1 : 2) - (b.status === "fail" ? 0 : b.status === "unknown" ? 1 : 2)).map((f) => FindingRow(f, prov))}
            </ul>
          </section>
          <div class="space-y-4">
            ${IntegrityBlock(rep)}
            <section class="rounded-lg border border-slate-800 bg-slate-900/50 p-5">
              <h2 class="text-sm font-semibold text-white">Provenance</h2>
              <p class="mt-2 text-xs text-slate-500">How much is independently verified</p>
              <ul class="mt-3 space-y-1.5 text-xs">
                ${Object.entries(rep.evidence.provenance).map(([k, v]) => html`<li class="flex justify-between"><span class="text-slate-400">${esc(k)}</span><span class="font-mono text-slate-300">${v}</span></li>`)}
              </ul>
            </section>
            <a href="/intel/reports/${d.latestJob!.id}" class="block rounded-lg border border-slate-800 bg-slate-900/50 p-4 text-sm text-emerald-300 hover:border-slate-600">View signed report →</a>
            <section class="rounded-lg border border-slate-800 bg-slate-900/50 p-5">
              <h2 class="text-sm font-semibold text-white">Client reports</h2>
              ${clientReports.length === 0 ? html`<p class="mt-2 text-xs text-slate-500">No client reports yet.</p>` : html`<ul class="mt-2 space-y-1">${clientReports.sort((a, b) => (a.period < b.period ? 1 : -1)).map((cr) => html`<li><a href="/intel/client-reports/${cr.id}" class="text-sm text-emerald-300 hover:text-emerald-200">${cr.period}</a> <span class="text-xs text-slate-500">${cr.status}</span></li>`)}</ul>`}
              ${canScan ? html`<form method="post" action="/intel/sites/${d.site.id}/client-report" class="mt-3"><button class="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:border-slate-600">Generate from latest scan</button></form>` : ""}
            </section>
          </div>
        </div>`}
    </div>`;
};
