import { html } from "hono/html";
import type { TierEntry } from "@agentgate-hedera/hedera-core";

const TIER_STYLES: Record<string, { border: string; badge: string; label: string }> = {
  bronze: {
    border: "border-amber-700/40",
    badge: "bg-amber-700/20 text-amber-300 border-amber-700/40",
    label: "Bronze",
  },
  silver: {
    border: "border-slate-500/40",
    badge: "bg-slate-500/20 text-slate-300 border-slate-500/40",
    label: "Silver",
  },
  gold: {
    border: "border-yellow-500/40",
    badge: "bg-yellow-500/20 text-yellow-300 border-yellow-500/40",
    label: "Gold",
  },
  platinum: {
    border: "border-emerald-500/40",
    badge: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40",
    label: "Platinum",
  },
};

/**
 * Catalog fragment — tier pricing cards.
 * (SLICE-4-2 variant, hackathon-flow.md:226-231 §6)
 *
 * @param tiers  4-tier catalog from getCatalog()
 */
export function CatalogFragment({ tiers }: { tiers: TierEntry[] }) {
  return html`<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
    ${tiers.map((tier) => {
    const style = TIER_STYLES[tier.name] ?? TIER_STYLES.bronze;
    return html`<div class="rounded-xl border ${style.border} bg-slate-900 p-6">
        <div class="flex items-center justify-between">
          <span class="rounded-full border ${style.badge} px-3 py-1 text-xs font-medium">
            ${style.label}
          </span>
          <span class="text-2xl font-semibold text-white">${tier.price}</span>
        </div>
        <div class="mt-1 text-right text-xs text-slate-400">HBAR</div>

        <ul class="mt-4 space-y-2">
          ${tier.capabilities.map(
      (cap) =>
        html`<li class="flex items-center gap-2 text-sm text-slate-300">
                <svg
                  class="h-4 w-4 text-emerald-400"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  stroke-width="2"
                >
                  <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                ${cap}
              </li>`,
    )}
        </ul>

        <a
          href="/ui/passport/request?tier=${tier.name}"
          class="mt-6 block rounded-lg border border-slate-700 bg-slate-800 py-2 text-center text-sm font-medium text-slate-200 hover:bg-slate-700"
        >
          Get ${style.label}
        </a>
      </div>`;
  })}
  </div>`;
}
