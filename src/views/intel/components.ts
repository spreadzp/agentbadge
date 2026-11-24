// EPIC-262 (SLICE-262-10): intel design tokens → components per
// docs/EPICS/262/DESIGN.md §5. Trust vocabulary is render-only:
// provenance/freshness/integrity are facts from stored records —
// this file never upgrades or invents them.

import { html, raw } from "hono/html";
import type { ScanJobStatus } from "../../server/lib/intel/scan";
import {
  CONSENT_KINDS,
  type ConsentKind,
  type ConsentStatus,
  type IntelConsent,
  type IntelConsentEvent,
} from "../../server/lib/intel/consent";
import type {
  IntelOwnershipProof,
  OwnershipStatus,
} from "../../server/lib/intel/registry";

const esc = (s: unknown) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

// ─── provenance chips (DESIGN §2.1) — fixed palette; self-reported
// is amber ON PURPOSE (unverified ≠ bad ≠ green) ───
const PROVENANCE: Record<string, { cls: string; label: string }> = {
  EXTERNAL_OBSERVED: { cls: "bg-sky-500/15 text-sky-300", label: "external observed" },
  PLUGIN_SELF_REPORTED: { cls: "bg-amber-500/15 text-amber-300", label: "plugin self-reported" },
  BACKEND_VERIFIED: { cls: "bg-emerald-500/15 text-emerald-300", label: "backend verified" },
  DERIVED: { cls: "bg-violet-500/15 text-violet-300", label: "derived" },
};
export const ProvenanceChip = (p: string) => {
  const v = PROVENANCE[p] ?? { cls: "bg-slate-800 text-slate-400", label: p.toLowerCase() };
  return html`<span class="rounded-full ${v.cls} px-2 py-0.5 text-xs">${v.label}</span>`;
};

// ─── two independent scores (DESIGN §2.2 — never merged) ───
export const ScoreChip = (axis: "readiness" | "exposure", score: number | null) => {
  if (score === null)
    return html`<span class="rounded-full bg-slate-800 px-2.5 py-0.5 text-lg font-bold text-slate-500">—</span>`;
  const cls =
    axis === "readiness"
      ? "bg-indigo-500/15 text-indigo-300"
      : "bg-rose-500/15 text-rose-300";
  return html`<span class="rounded-full ${cls} px-2.5 py-0.5 text-lg font-bold">${score}</span>`;
};

// ─── freshness — facts not vibes (DESIGN §2.3) ───
export const FreshnessCell = (receivedAtMax: string | null, now = new Date()) => {
  if (!receivedAtMax)
    return html`<span class="text-slate-500">no evidence</span>`;
  const days = Math.max(
    0,
    Math.floor((now.getTime() - Date.parse(receivedAtMax)) / 86_400_000),
  );
  const cls =
    days > 90 ? "text-rose-300" : days > 30 ? "text-amber-300" : "text-slate-300";
  const label = days === 0 ? "today" : days === 1 ? "1d ago" : `${days}d ago`;
  return html`<span class="${cls}">${label}</span>`;
};

// ─── job state chip (DESIGN §2.5) ───
const JOB: Record<ScanJobStatus, { cls: string; label: string }> = {
  queued: { cls: "bg-slate-800 text-slate-400", label: "queued" },
  running: { cls: "bg-sky-500/15 text-sky-300", label: "running" },
  complete: { cls: "bg-emerald-500/15 text-emerald-300", label: "complete" },
  partial: { cls: "bg-amber-500/15 text-amber-300", label: "partial" },
  failed: { cls: "bg-rose-500/15 text-rose-300", label: "failed" },
};
export const JobStateChip = (s: ScanJobStatus) => {
  const v = JOB[s];
  return html`<span class="rounded-full ${v.cls} px-2 py-0.5 text-xs">${v.label}</span>`;
};

// ─── ownership badges — two independent scopes (DESIGN §2.6) ───
const OWN: Record<OwnershipStatus, string> = {
  verified: "bg-emerald-500/15 text-emerald-300",
  pending: "bg-slate-800 text-slate-400",
  expired: "bg-amber-500/15 text-amber-300",
  revoked: "bg-rose-500/15 text-rose-300",
};
const daysUntil = (iso: string | null, now = new Date()) =>
  iso ? Math.max(0, Math.ceil((Date.parse(iso) - now.getTime()) / 86_400_000)) : null;
export const OwnershipBadge = (
  kind: "installation_control" | "domain_control",
  proof: IntelOwnershipProof | null,
) => {
  if (!proof)
    return html`<span class="rounded-full bg-slate-800 px-2.5 py-1 text-xs text-slate-400">${esc(kind)} · none</span>`;
  const reverify = daysUntil(proof.reverifyAfter);
  const tail =
    proof.status === "verified" && reverify !== null
      ? ` · re-verify in ${reverify}d`
      : "";
  return html`<span class="inline-flex items-center gap-1.5 rounded-full ${OWN[proof.status]} px-2.5 py-1 text-xs">${esc(kind)} · ${proof.method}${tail}</span>`;
};

// ─── consent badge ───
export const ConsentBadge = (consents: IntelConsent[], kind = "audit") => {
  const c = consents.find((x) => x.kind === kind);
  const status: ConsentStatus | "none" = c
    ? c.revokedAt
      ? "revoked"
      : c.status
    : "none";
  const cls =
    status === "granted"
      ? "bg-emerald-500/15 text-emerald-300"
      : status === "revoked"
        ? "bg-rose-500/15 text-rose-300"
        : "bg-slate-800 text-slate-400";
  return html`<span class="rounded-full ${cls} px-2.5 py-1 text-xs">consent: ${kind} · ${status}</span>`;
};

// ─── SLICE-262-23 — consent management panel: every kind with a
// status badge + grant/revoke form (hidden for viewers), then the
// append-only history. Apply/publication are manageable now; their
// enforcement lands with 262-26 / 262-29 — the labels say so,
// never implying a gate that isn't wired yet. ───
const KIND_COPY: Record<ConsentKind, { label: string; what: string }> = {
  audit: {
    label: "Audit",
    what: "External scans and the signed agent-surface report. Revoking stops all paid scan operations immediately.",
  },
  inside_diagnostics: {
    label: "Inside diagnostics",
    what: "The plugin may claim signed pull-jobs (option reads, declared URLs). Checked at claim AND again at result-submit — mid-flight revocation rejects the result.",
  },
  apply: {
    label: "Fix apply",
    what: "Permission for backend-written fixes (fix_apply jobs). Enforced when the fixer pipeline ships — granting now only records intent.",
  },
  publication: {
    label: "Publication",
    what: "Permission to publish attestations on the public verification surface. Enforced when verification ships — granting now only records intent.",
  },
};

const consentStatusOf = (
  consents: IntelConsent[],
  kind: ConsentKind,
): { status: ConsentStatus | "none"; row: IntelConsent | null } => {
  const row = consents.find((x) => x.kind === kind) ?? null;
  const status: ConsentStatus | "none" = row
    ? row.revokedAt
      ? "revoked"
      : row.status
    : "none";
  return { status, row };
};

export const ConsentPanel = (
  siteId: string,
  consents: IntelConsent[],
  events: IntelConsentEvent[],
  canManage: boolean,
) => {
  const STATUS_CLS: Record<string, string> = {
    granted: "bg-emerald-500/15 text-emerald-300",
    revoked: "bg-rose-500/15 text-rose-300",
    none: "bg-slate-800 text-slate-400",
  };
  return html`<section class="mt-6 rounded-lg border border-slate-800 bg-slate-900/50 p-5">
    <h2 class="text-sm font-semibold text-white">Consent</h2>
    <p class="mt-1 text-xs text-slate-500">Permission for specific actions — independent of subscription and site_key. Revocation stops paid operations even while the subscription is alive.</p>
    <ul class="mt-4 divide-y divide-slate-800/60">
      ${CONSENT_KINDS.map((kind) => {
        const { status, row } = consentStatusOf(consents, kind);
        const copy = KIND_COPY[kind];
        return html`<li class="flex flex-wrap items-start justify-between gap-3 py-3">
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-2">
              <span class="text-sm font-medium text-white">${copy.label}</span>
              <span class="rounded-full ${STATUS_CLS[status]} px-2 py-0.5 text-xs">${status}</span>
              <span class="font-mono text-xs text-slate-500">${kind}</span>
            </div>
            <p class="mt-1 text-xs text-slate-400">${copy.what}</p>
            ${row ? html`<p class="mt-1 text-xs text-slate-500">
              ${status === "granted" ? `granted ${row.grantedAt.slice(0, 10)}` : ""}${status === "revoked" ? `granted ${row.grantedAt.slice(0, 10)} · revoked ${row.revokedAt!.slice(0, 10)}` : ""}
              · by ${esc(row.grantedByPrincipal)} ${esc(row.grantedById)}
            </p>` : ""}
          </div>
          ${canManage ? html`
            <form method="post" action="/intel/sites/${siteId}/consent" class="shrink-0">
              <input type="hidden" name="kind" value="${kind}" />
              ${status === "granted"
                ? html`<input type="hidden" name="action" value="revoke" /><button class="rounded-lg border border-rose-800 px-3 py-1.5 text-xs text-rose-300 hover:bg-rose-500/10">Revoke</button>`
                : html`<input type="hidden" name="action" value="grant" /><button class="rounded-lg border border-emerald-800 px-3 py-1.5 text-xs text-emerald-300 hover:bg-emerald-500/10">Grant</button>`}
            </form>` : ""}
        </li>`;
      })}
    </ul>
    ${events.length > 0 ? html`
      <h3 class="mt-4 text-xs font-semibold text-slate-400">History</h3>
      <ul class="mt-2 space-y-1">
        ${events.slice(0, 20).map((e) => html`<li class="flex flex-wrap items-baseline gap-2 text-xs">
          <span class="font-mono text-slate-500">${e.at.slice(0, 16).replace("T", " ")}Z</span>
          <span class="${e.action === "granted" ? "text-emerald-300" : "text-rose-300"}">${e.action}</span>
          <span class="font-mono text-slate-400">${e.kind}</span>
          <span class="text-slate-500">by ${esc(e.principal)} ${esc(e.principalId)}</span>
        </li>`)}
      </ul>` : ""}
  </section>`;
};

// ─── integrity block (DESIGN §2.4) — signature proves integrity,
// not truth; provenance summary must sit next to it ───
export const IntegrityBlock = (r: {
  integrity: { content_hash: string; signature: { algorithm: string; key_id: string; value: string } };
  previous_hash: string | null;
  scan: { completeness: string };
}) => html`<section class="rounded-lg border border-slate-800 bg-slate-900/50 p-5">
  <h2 class="text-sm font-semibold text-white">Signed canonical report</h2>
  <dl class="mt-3 grid gap-x-8 gap-y-1 font-mono text-xs text-slate-400 sm:grid-cols-2">
    <div class="flex gap-2"><dt class="text-slate-500">algorithm</dt><dd>${r.integrity.signature.algorithm}</dd></div>
    <div class="flex gap-2"><dt class="text-slate-500">key_id</dt><dd>${esc(r.integrity.signature.key_id)}</dd></div>
    <div class="flex gap-2"><dt class="text-slate-500">content_hash</dt><dd>${esc(r.integrity.content_hash.slice(0, 20))}…</dd></div>
    <div class="flex gap-2"><dt class="text-slate-500">completeness</dt><dd>${r.scan.completeness}</dd></div>
    <div class="flex gap-2 sm:col-span-2"><dt class="text-slate-500">chain</dt><dd>${r.previous_hash ? `${esc(r.previous_hash.slice(7, 15))}… → ${esc(r.integrity.content_hash.slice(7, 15))}…` : "genesis"}</dd></div>
  </dl>
  <p class="mt-3 text-xs text-slate-600">Signature proves this report was not modified — provenance chips show how much is independently verified.</p>
</section>`;

// ─── finding row (DESIGN §3 findings) ───
const STATUS_ICON: Record<string, string> = {
  fail: '<svg class="mt-0.5 h-4 w-4 shrink-0 text-rose-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>',
  pass: '<svg class="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>',
  warn: '<svg class="mt-0.5 h-4 w-4 shrink-0 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v4m0 4h.01M12 3l10 18H2z"/></svg>',
  unknown: '<svg class="mt-0.5 h-4 w-4 shrink-0 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M8.25 9.75a4.5 4.5 0 118.25 2.6c-1.5 1-2.25 1.9-2.25 3.15m0 3h.01"/></svg>',
};
const RULE_CLS: Record<string, string> = {
  fail: "text-rose-300",
  pass: "text-emerald-300",
  warn: "text-amber-300",
  unknown: "text-slate-400",
};
/** provenance lookup map — envelope_id → provenance class */
export type EvidenceProvenanceMap = Record<string, string>;

export const FindingRow = (
  f: {
    rule_id: string;
    name: string;
    status: string;
    claim: string;
    reason: string;
    evidence_ids: string[];
  },
  evidenceProv: EvidenceProvenanceMap = {},
) => {
  const prov = provenanceFor(f.evidence_ids, evidenceProv);
  return html`<li class="flex items-start gap-3 py-4">
    ${raw(STATUS_ICON[f.status] ?? STATUS_ICON.unknown)}
    <div class="min-w-0 flex-1">
      <div class="flex flex-wrap items-center gap-2">
        <span class="font-mono text-sm ${RULE_CLS[f.status]}">${esc(f.rule_id)}</span>
        <span class="text-sm font-medium ${f.status === "unknown" ? "text-slate-300" : "text-white"}">${esc(f.name)}</span>
        ${ProvenanceChip(prov)}
        ${f.status === "unknown" ? html`<span class="rounded-full bg-slate-800 px-2 py-0.5 text-xs text-slate-400">unknown</span>` : ""}
      </div>
      <p class="mt-1 text-sm ${f.status === "unknown" ? "text-slate-500" : "text-slate-400"}">${esc(f.claim)}</p>
      ${f.reason !== f.claim ? html`<p class="mt-0.5 text-xs text-slate-500">${esc(f.reason)}</p>` : ""}
      ${f.evidence_ids.length > 0 ? html`<p class="mt-1 text-xs text-slate-500">evidence: ${raw(f.evidence_ids.map((id) => `<span class="font-mono text-slate-400">${esc(id)}</span>`).join(" · "))}</p>` : ""}
    </div>
  </li>`;
};

// A finding's chip reflects the strongest provenance class among its
// evidence refs: verified > observed > self-reported > derived.
const PROVENANCE_RANK = [
  "BACKEND_VERIFIED",
  "EXTERNAL_OBSERVED",
  "PLUGIN_SELF_REPORTED",
  "DERIVED",
] as const;
function provenanceFor(
  evidenceIds: string[],
  prov: EvidenceProvenanceMap,
): string {
  const classes = evidenceIds
    .map((id) => prov[id])
    .filter((x): x is string => Boolean(x));
  for (const p of PROVENANCE_RANK) {
    if (classes.includes(p)) return p;
  }
  return classes[0] ?? "DERIVED";
}
