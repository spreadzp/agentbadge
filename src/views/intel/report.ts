// EPIC-262 (SLICE-262-10): signed-report page — the canonical
// IntelReport verbatim: integrity block, evidence summary, findings.
// Signature = integrity, not truth (DESIGN §2.4).
import { html } from "hono/html";
import type { IntelReport } from "../../server/lib/intel/report";
import type { ScanJob } from "../../server/lib/intel/scan";
import {
  type EvidenceProvenanceMap,
  FindingRow,
  FreshnessCell,
  IntegrityBlock,
  JobStateChip,
  ScoreChip,
} from "./components";

const esc = (s: unknown) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export const IntelReportPage = (
  job: ScanJob,
  rep: IntelReport,
  hostname: string | null,
  prov: EvidenceProvenanceMap,
) => html`
  <div class="mx-auto max-w-4xl py-8">
    <a href="/intel/sites/${job.siteId}" class="text-xs text-slate-500 hover:text-slate-300">← ${esc(hostname ?? "site")}</a>
    <div class="mt-4 flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 class="text-2xl font-bold text-white">Scan report</h1>
        <p class="mt-1 font-mono text-xs text-slate-500">${job.scanId} · ${rep.scan.generated_at} ${JobStateChip(job.status)}</p>
      </div>
      <div class="flex items-center gap-4">
        <div class="text-center"><p class="text-xs text-slate-500">readiness</p>${ScoreChip("readiness", rep.scores.readiness.score)}</div>
        <div class="text-center"><p class="text-xs text-slate-500">exposure</p>${ScoreChip("exposure", rep.scores.exposure.score)}</div>
      </div>
    </div>

    <div class="mt-6">${IntegrityBlock(rep)}</div>

    <section class="mt-6 rounded-lg border border-slate-800 bg-slate-900/50 p-5">
      <h2 class="text-sm font-semibold text-white">Evidence summary</h2>
      <dl class="mt-3 grid gap-x-8 gap-y-1 text-xs sm:grid-cols-2">
        <div class="flex gap-2"><dt class="text-slate-500">envelopes</dt><dd class="text-slate-300">${rep.evidence.envelope_count}</dd></div>
        <div class="flex gap-2"><dt class="text-slate-500">freshness</dt><dd>${FreshnessCell(rep.evidence.received_at_max)}</dd></div>
        <div class="flex gap-2"><dt class="text-slate-500">collected</dt><dd class="font-mono text-slate-400">${rep.evidence.collected_at_min ?? "—"} → ${rep.evidence.received_at_max ?? "—"}</dd></div>
        <div class="flex gap-2"><dt class="text-slate-500">probes</dt><dd class="text-slate-300">${job.probeTotal - job.probeFailures}/${job.probeTotal} ok</dd></div>
      </dl>
    </section>

    <section class="mt-6 rounded-lg border border-slate-800 bg-slate-900/50 p-5">
      <h2 class="text-sm font-semibold text-white">Findings</h2>
      <ul class="divide-y divide-slate-800/60">
        ${[...rep.findings].sort((a, b) => (a.status === "fail" ? 0 : a.status === "unknown" ? 1 : 2) - (b.status === "fail" ? 0 : b.status === "unknown" ? 1 : 2)).map((f) => FindingRow(f, prov))}
      </ul>
    </section>
  </div>`;
