import { html } from "hono/html";
import type { AuditMessage, Tier } from "@agentgate-hedera/hedera-core";

/**
 * Stats fragment — live counters for the dashboard.
 * (SLICE-4-2, hackathon-flow.md:127 — polls every 10s)
 *
 * @param totalIssued    Total passports issued (NFT count)
 * @param totalUpgrades  Total tier upgrade events
 * @param activeCount    Active (non-revoked) passports
 * @param revokedCount   Revoked passports
 * @param byTier         Tier breakdown: { bronze: N, silver: N, gold: N, platinum: N }
 */
export function StatsFragment({
  totalIssued,
  totalUpgrades,
  activeCount,
  revokedCount,
  byTier,
}: {
  totalIssued: number;
  totalUpgrades: number;
  activeCount: number;
  revokedCount: number;
  byTier: Record<Tier, number>;
}) {
  const tiers: Tier[] = ["bronze", "silver", "gold", "platinum"];

  return html`<div class="grid grid-cols-2 gap-4 md:grid-cols-4">
      <div class="rounded-lg border border-slate-800 bg-slate-900 p-4">
        <div class="text-xs uppercase tracking-wide text-slate-400">Issued</div>
        <div class="mt-1 text-2xl font-semibold text-white">${totalIssued}</div>
      </div>
      <div class="rounded-lg border border-slate-800 bg-slate-900 p-4">
        <div class="text-xs uppercase tracking-wide text-slate-400">Upgrades</div>
        <div class="mt-1 text-2xl font-semibold text-white">${totalUpgrades}</div>
      </div>
      <div class="rounded-lg border border-slate-800 bg-slate-900 p-4">
        <div class="text-xs uppercase tracking-wide text-slate-400">Active</div>
        <div class="mt-1 text-2xl font-semibold text-emerald-400">${activeCount}</div>
      </div>
      <div class="rounded-lg border border-slate-800 bg-slate-900 p-4">
        <div class="text-xs uppercase tracking-wide text-slate-400">Revoked</div>
        <div class="mt-1 text-2xl font-semibold text-red-400">${revokedCount}</div>
      </div>
    </div>

    <div class="mt-4 rounded-lg border border-slate-800 bg-slate-900 p-4">
      <h3 class="text-sm font-semibold text-white mb-3">Tier Breakdown</h3>
      <div class="flex flex-wrap gap-4">
        ${tiers.map(
    (tier) =>
      html`<div class="flex items-center gap-2">
              <span class="text-sm text-slate-300 capitalize">${tier}</span>
              <span class="text-lg font-semibold text-emerald-400">${byTier[tier] ?? 0}</span>
            </div>`,
  )}
      </div>
    </div>`;
}
