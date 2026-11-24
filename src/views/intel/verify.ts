// EPIC-262 (SLICE-262-29): public verification page — the opt-in
// status card for /verify/agent-surface/:siteId. Honest states only:
// active / expired / revoked / not-yet-attested, never a fake
// "verified" for a revoked or missing attestation.
import { html } from "hono/html";
import type {
  AttestationEffectiveStatus,
  IntelAttestation,
} from "../../server/lib/intel/attestation";

const esc = (s: unknown) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const STATUS: Record<
  AttestationEffectiveStatus,
  { cls: string; label: string; note: string }
> = {
  active: {
    cls: "bg-emerald-500/15 text-emerald-300 border-emerald-800",
    label: "Verified — active",
    note: "A signed attestation covers this site's latest agent-surface report.",
  },
  expired: {
    cls: "bg-amber-500/15 text-amber-300 border-amber-800",
    label: "Expired",
    note: "The attestation's validity window has passed — the scores below describe a past scan, not the current state.",
  },
  revoked: {
    cls: "bg-rose-500/15 text-rose-300 border-rose-800",
    label: "Revoked",
    note: "This attestation was revoked — the claim below must not be relied on.",
  },
};

export const IntelVerifyPage = (
  siteId: string,
  attestation: IntelAttestation | null,
  status: AttestationEffectiveStatus | null,
  signatureValid: boolean | null,
) => {
  if (!attestation) {
    return html`<div class="mx-auto max-w-2xl py-12 text-center">
      <p class="text-xs uppercase tracking-widest text-slate-500">AgentBadge · agent-surface verification</p>
      <h1 class="mt-3 text-2xl font-bold text-white">Not yet attested</h1>
      <p class="mt-3 text-sm text-slate-400">This site opted in to public verification, but no signed attestation has been issued yet. Check back after the next scan.</p>
      <p class="mt-6 font-mono text-xs text-slate-600">${esc(siteId)}</p>
    </div>`;
  }
  const s = STATUS[status!];
  return html`<div class="mx-auto max-w-2xl py-12">
    <p class="text-center text-xs uppercase tracking-widest text-slate-500">AgentBadge · agent-surface verification</p>
    <div class="mt-4 rounded-xl border ${s.cls.split(" ")[2]} bg-slate-900/50 p-6">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <span class="rounded-full ${s.cls} border px-3 py-1 text-sm font-semibold">${s.label}</span>
        <span class="text-xs text-slate-500">${signatureValid === true ? "signature ✓ verified at render" : signatureValid === false ? "signature ✗ INVALID" : ""}</span>
      </div>
      <p class="mt-3 text-sm text-slate-400">${s.note}</p>

      <dl class="mt-5 grid gap-x-8 gap-y-2 font-mono text-xs text-slate-400 sm:grid-cols-2">
        <div class="flex justify-between gap-2"><dt class="text-slate-500">readiness</dt><dd class="text-lg font-bold text-indigo-300">${attestation.scores.readiness.score ?? "—"}</dd></div>
        <div class="flex justify-between gap-2"><dt class="text-slate-500">exposure</dt><dd class="text-lg font-bold text-rose-300">${attestation.scores.exposure.score ?? "—"}</dd></div>
        <div class="flex justify-between gap-2"><dt class="text-slate-500">ruleset</dt><dd>${esc(attestation.ruleset.name)} ${esc(attestation.ruleset.version)}</dd></div>
        <div class="flex justify-between gap-2"><dt class="text-slate-500">site</dt><dd class="truncate">${esc(attestation.site_id)}</dd></div>
        <div class="flex justify-between gap-2"><dt class="text-slate-500">issued</dt><dd>${attestation.issued.slice(0, 10)}</dd></div>
        <div class="flex justify-between gap-2"><dt class="text-slate-500">valid until</dt><dd>${attestation.valid_until.slice(0, 10)}</dd></div>
        ${attestation.status === "revoked" ? html`
          <div class="flex justify-between gap-2"><dt class="text-slate-500">revoked at</dt><dd>${attestation.revoked_at?.slice(0, 10) ?? "—"}</dd></div>
          <div class="flex justify-between gap-2"><dt class="text-slate-500">reason</dt><dd class="truncate">${esc(attestation.revoked_reason ?? "—")}</dd></div>` : ""}
        <div class="flex justify-between gap-2 sm:col-span-2"><dt class="text-slate-500">attestation</dt><dd>${esc(attestation.attestation_id)}</dd></div>
        <div class="flex justify-between gap-2 sm:col-span-2"><dt class="text-slate-500">report</dt><dd>${esc(attestation.report_id)}</dd></div>
        <div class="flex justify-between gap-2 sm:col-span-2"><dt class="text-slate-500">content hash</dt><dd class="break-all">${esc(attestation.content_hash)}</dd></div>
        <div class="flex justify-between gap-2 sm:col-span-2"><dt class="text-slate-500">signature</dt><dd class="break-all">${attestation.signature.algorithm} · ${esc(attestation.signature.key_id)}</dd></div>
      </dl>
    </div>
    <p class="mt-4 text-center text-xs text-slate-500">
      Verify independently: fetch
      <a href="/.well-known/agentbadge-keys.json" class="text-emerald-300 hover:text-emerald-200">/.well-known/agentbadge-keys.json</a>,
      match <span class="font-mono">${esc(attestation.signature.key_id)}</span>, check the Ed25519 signature over the JCS-canonical body.
    </p>
  </div>`;
};
