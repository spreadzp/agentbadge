/**
 * Shared venue UI primitives (extracted to keep files under max-lines).
 * Plain string builders — no hono imports needed.
 */

export const CARD =
  "rounded-xl border border-slate-700/50 bg-slate-900/30 p-6 hover:border-emerald-500/40 transition-colors";

export function esc(s: string | number | undefined): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function shortAddr(addr?: string): string {
  if (!addr) return "—";
  return addr.length > 14 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr;
}

export function shortHash(hash?: string): string {
  return hash ? `${hash.slice(0, 10)}…${hash.slice(-6)}` : "—";
}

export const VENUE_CARD = CARD;

// ─── Tab shell (D9-151) ──────────────────────────────────────────

export type VenueTab =
  | "services"
  | "jobs"
  | "attestations"
  | "providers"
  | "passes";

const TABS: { id: VenueTab; label: string; href: string }[] = [
  { id: "services", label: "Services", href: "/market/services" },
  { id: "jobs", label: "Jobs", href: "/market/jobs" },
  { id: "attestations", label: "Attestations", href: "/market/attestations" },
  { id: "providers", label: "Providers", href: "/market/providers" },
  { id: "passes", label: "Passes", href: "/market/passes" },
];

export function venueTabs(active: VenueTab): string {
  const links = TABS.map((t) => {
    const on = t.id === active;
    return `<a href="${t.href}" class="rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
      on
        ? "bg-emerald-600/20 text-emerald-300 border border-emerald-700/50"
        : "text-slate-400 hover:text-slate-200 border border-transparent"
    }">${t.label}</a>`;
  }).join("");
  return `<nav class="mt-6 flex flex-wrap gap-2">${links}</nav>`;
}

// ─── Job status badge ────────────────────────────────────────────

export function jobStatusBadge(status: string): string {
  const colors: Record<string, string> = {
    pending: "bg-slate-800 text-slate-300 border-slate-600",
    open: "bg-emerald-900 text-emerald-300 border-emerald-700",
    funded: "bg-amber-900 text-amber-300 border-amber-700",
    submitted: "bg-blue-900 text-blue-300 border-blue-700",
    completed: "bg-slate-700 text-slate-300 border-slate-600",
    rejected: "bg-red-900 text-red-300 border-red-700",
    expired: "bg-slate-800 text-slate-500 border-slate-700",
  };
  return `<span class="px-2 py-0.5 rounded text-xs font-medium border ${colors[status] ?? colors.pending}">${esc(status)}</span>`;
}

/** Compact relative timestamp for feed rows. */
export function relTime(iso: string): string {
  const s = Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
