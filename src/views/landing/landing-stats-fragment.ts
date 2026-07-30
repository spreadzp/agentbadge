import { html, raw } from "hono/html";

/**
 * LandingStatsFragment — HTMX fragment for landing page live stats.
 *
 * Returns the same 4-card format with icons as the initial SSR render.
 * Used by GET /ui/landing-stats endpoint (polled every 10s).
 */
export function LandingStatsFragment(data: {
  totalIssued: number;
  activeCount: number;
  totalUpgrades: number;
  tasksCount: number;
}) {
  const { totalIssued, activeCount, totalUpgrades, tasksCount } = data;

  const cards = [
    { label: "Passports Issued", value: totalIssued, color: "text-white", icon: "M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" },
    { label: "Active Agents", value: activeCount, color: "text-emerald-400", icon: "M17 20h5v-2a4 4 0 00-3-3.87M9 20H4v-2a4 4 0 013-3.87m6-1.13a4 4 0 100-8 4 4 0 000 8z" },
    { label: "Marketplace Tasks", value: tasksCount, color: "text-sky-400", icon: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" },
    { label: "Tier Upgrades", value: totalUpgrades, color: "text-amber-400", icon: "M13 10V3L4 14h7v7l9-11h-7z" },
  ];

  return html`${raw(
    cards
      .map(
        (card) => html`<div class="hover-lift rounded-xl border border-slate-800 bg-slate-900/80 p-6 text-center">
            <div class="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-slate-800">
              <svg class="h-5 w-5 ${card.color}" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" d="${card.icon}" />
              </svg>
            </div>
            <div class="text-3xl font-bold ${card.color}">${card.value}</div>
            <div class="mt-1 text-xs uppercase tracking-wide text-slate-400">${card.label}</div>
          </div>`,
      )
      .join(""),
  )}`;
}
