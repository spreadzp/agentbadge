// EPIC-262 (SLICE-262-27b): requires-attention feed — the
// monitoring lane of the dashboard. Alerts are derived at read
// (never stored), grouped P1 → P3; the empty state is honest
// ("no attention items", not "everything is fine").
import { html } from "hono/html";
import type {
  AlertSeverity,
  IntelAlert,
} from "../../server/lib/intel/monitoring/alerts";

const esc = (s: unknown) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const SEV_META: Record<
  AlertSeverity,
  { cls: string; title: string; blurb: string }
> = {
  P1: {
    cls: "border-rose-800 bg-rose-500/10 text-rose-300",
    title: "P1 — act now",
    blurb: "Exposed surface or a broken scan — real risk on a live site.",
  },
  P2: {
    cls: "border-amber-800 bg-amber-500/10 text-amber-300",
    title: "P2 — schedule",
    blurb: "Stale evidence, partial scans, attestation expiry.",
  },
  P3: {
    cls: "border-slate-700 bg-slate-800/40 text-slate-400",
    title: "P3 — when convenient",
    blurb: "Not-yet-scanned sites and revoked consent.",
  },
};

export const IntelAlertsPage = (
  alerts: IntelAlert[],
  generatedAt: string,
) => {
  const groups = (["P1", "P2", "P3"] as const).map((sev) => ({
    sev,
    items: alerts.filter((a) => a.severity === sev),
  }));
  return html`<div class="mx-auto max-w-4xl py-8">
    <a href="/intel" class="text-xs text-slate-500 hover:text-slate-300">← portfolio</a>
    <div class="mt-4 flex flex-wrap items-baseline justify-between gap-2">
      <h1 class="text-2xl font-bold text-white">Attention feed</h1>
      <p class="text-xs text-slate-500">generated ${generatedAt.slice(0, 16).replace("T", " ")}Z · ${alerts.length} item${alerts.length === 1 ? "" : "s"}</p>
    </div>
    <p class="mt-2 text-sm text-slate-400">Derived from live state on every load — nothing here can go stale. Dismissing an item means fixing the cause on the site.</p>

    ${alerts.length === 0 ? html`
      <section class="mt-8 rounded-lg border border-slate-800 bg-slate-900/50 p-8 text-center">
        <p class="text-sm font-medium text-slate-300">No attention items right now</p>
        <p class="mt-2 text-xs text-slate-500">Every site is either healthy, recently scanned, or not yet onboarded. This list repopulates the moment a scan fails, evidence goes stale, or exposure appears.</p>
      </section>` : ""}

    ${groups.map(({ sev, items }) => items.length === 0 ? "" : html`
      <section class="mt-6">
        <h2 class="text-xs font-semibold uppercase tracking-widest text-slate-500">${SEV_META[sev].title} <span class="ml-1 normal-case text-slate-600">${SEV_META[sev].blurb}</span></h2>
        <ul class="mt-2 space-y-2">
          ${items.map((a) => html`<li class="rounded-lg border ${SEV_META[sev].cls.split(" ").slice(0, 2).join(" ")} p-4">
            <div class="flex flex-wrap items-start justify-between gap-2">
              <div class="min-w-0 flex-1">
                <p class="text-sm font-medium text-white">${esc(a.headline)}</p>
                <p class="mt-1 text-xs text-slate-400">${esc(a.detail)}</p>
                <p class="mt-2 text-xs text-slate-500">→ ${esc(a.action)}</p>
              </div>
              <a href="${a.href}" class="shrink-0 rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:border-slate-500">site →</a>
            </div>
          </li>`)}
        </ul>
      </section>`)}
  </div>`;
};
