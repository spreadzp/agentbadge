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
 * Passport request form — agent fills details to request a passport NFT.
 * Pre-fills tier from query param. Submits via HTMX to POST /passport/request.
 */
export function PassportRequestForm({
  tiers,
  selectedTier,
}: {
  tiers: TierEntry[];
  selectedTier?: string;
}) {
  const tier = selectedTier ?? "bronze";
  const style = TIER_STYLES[tier] ?? TIER_STYLES.bronze;
  const tierEntry = tiers.find((t) => t.name === tier) ?? tiers[0];

  return html`<section class="rounded-xl border ${style.border} bg-slate-900 p-8">
    <div class="flex items-center justify-between">
      <h1 class="text-2xl font-semibold text-white">Request Passport</h1>
      <span class="rounded-full border ${style.badge} px-3 py-1 text-xs font-medium">
        ${style.label} · ${tierEntry.price} HBAR
      </span>
    </div>

    <p class="mt-3 text-sm text-slate-300">
      Fill in your agent details to mint an on-chain passport NFT on Hedera. Payment is processed
      via x402 protocol (HBAR transfer).
    </p>

    <form
      hx-post="/passport/request"
      hx-swap="innerHTML"
      hx-target="#result"
      class="mt-6 space-y-4"
    >
      <input type="hidden" name="tier" value="${tier}" />

      <div>
        <label for="accountId" class="block text-sm font-medium text-slate-300">
          Hedera Account ID
        </label>
        <input
          type="text"
          id="accountId"
          name="accountId"
          placeholder="0.0.1234"
          required
          class="mt-1 block w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
        />
      </div>

      <div>
        <label for="name" class="block text-sm font-medium text-slate-300"> Agent Name </label>
        <input
          type="text"
          id="name"
          name="name"
          placeholder="My AI Agent"
          required
          class="mt-1 block w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
        />
      </div>

      <div>
        <label for="endpoint" class="block text-sm font-medium text-slate-300">
          Agent Endpoint (URL) — <span class="text-slate-500">optional, auto-generated from account ID</span>
        </label>
        <input
          type="url"
          id="endpoint"
          name="endpoint"
          placeholder="http://localhost:4021/ui/agents/0.0.YOUR_ACCOUNT_ID"
          class="mt-1 block w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
        />
      </div>

      <div>
        <label for="signature" class="block text-sm font-medium text-slate-300">
          Wallet Signature
        </label>
        <input
          type="text"
          id="signature"
          name="signature"
          placeholder="Hex-encoded signature of your account ID"
          required
          class="mt-1 block w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
        />
        <p class="mt-1 text-xs text-slate-400">
          Sign your account ID with your Hedera private key to prove wallet ownership.
        </p>
      </div>

      <div>
        <label class="block text-sm font-medium text-slate-300"> Capabilities </label>
        <div class="mt-2 flex flex-wrap gap-2">
          ${tierEntry.capabilities.map(
    (cap) =>
      html`<label
                class="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm text-slate-300"
              >
                <input
                  type="checkbox"
                  name="capabilities"
                  value="${cap}"
                  checked
                  class="h-4 w-4 rounded border-slate-600 text-emerald-500 focus:ring-emerald-500"
                />
                ${cap}
              </label>`,
  )}
        </div>
        <p class="mt-1 text-xs text-slate-400">
          Pre-selected based on ${style.label} tier. You can deselect capabilities you don't need.
        </p>
      </div>

      <button
        type="submit"
        class="w-full rounded-lg border border-emerald-500/40 bg-emerald-500/10 py-2.5 text-sm font-medium text-emerald-300 hover:bg-emerald-500/20"
      >
        Request ${style.label} Passport · ${tierEntry.price} HBAR
      </button>
    </form>

    <div id="result" class="mt-4"></div>

    <div class="mt-6 border-t border-slate-800 pt-4">
      <h2 class="text-sm font-medium text-slate-300">Other Tiers</h2>
      <div class="mt-2 flex flex-wrap gap-2">
        ${tiers.map(
    (t) =>
      html`<a
              href="/ui/passport/request?tier=${t.name}"
              class="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-700 ${t.name === tier ? "ring-1 ring-emerald-500" : ""}"
            >
              ${TIER_STYLES[t.name]?.label ?? t.name} · ${t.price} HBAR
            </a>`,
  )}
      </div>
    </div>
  </section>`;
}
