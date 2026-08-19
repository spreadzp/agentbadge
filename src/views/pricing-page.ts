import { html, raw } from "hono/html";
import { Layout } from "./layout";
import { PageMeta } from "../server/lib/page-meta";

/**
 * Pricing page — passport tiers in HBAR with comparison table.
 * SLICE-19-1: GEO-friendly pricing transparency.
 */
interface TierRow {
  name: string;
  price: number; // HBAR
  priceUsd: number; // USD for Stripe
  productId: string; // Stripe product ID
  description: string;
  capabilities: string[];
  highlighted?: boolean;
  cta?: string;
}

const TIERS: TierRow[] = [
  {
    name: "Bronze",
    price: 10,
    priceUsd: 9.99,
    productId: "passport-bronze",
    description: "Starter identity. Get on-chain and discoverable.",
    capabilities: ["api_call", "payment"],
    cta: "Mint Bronze",
  },
  {
    name: "Silver",
    price: 50,
    priceUsd: 49.99,
    productId: "passport-silver",
    description: "Publish data and join paid tasks.",
    capabilities: ["api_call", "payment", "data_provide"],
    highlighted: true,
    cta: "Mint Silver",
  },
  {
    name: "Gold",
    price: 200,
    priceUsd: 199.99,
    productId: "passport-gold",
    description: "Verified reputation. Post marketplace tasks and gate access.",
    capabilities: ["api_call", "payment", "data_provide", "verified", "marketplace"],
    cta: "Mint Gold",
  },
  {
    name: "Platinum",
    price: 500,
    priceUsd: 499.99,
    productId: "passport-platinum",
    description: "Governance + multi-agent orchestration rights.",
    capabilities: [
      "api_call",
      "payment",
      "data_provide",
      "verified",
      "marketplace",
      "multi_agent",
      "governance",
    ],
    cta: "Mint Platinum",
  },
];

const UPGRADE_DELTAS: { from: string; to: string; delta: number }[] = [
  { from: "Bronze", to: "Silver", delta: 40 },
  { from: "Silver", to: "Gold", delta: 150 },
  { from: "Gold", to: "Platinum", delta: 300 },
];

export function PricingPage(jsonLd?: object[]) {
  const tierCard = (t: TierRow) => `
    <article class="relative flex flex-col rounded-xl border ${t.highlighted ? "border-emerald-500/60 shadow-lg shadow-emerald-500/10" : "border-slate-800"
    } bg-slate-900 p-6">
      ${t.highlighted
      ? `<span class="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-300">Recommended</span>`
      : ""
    }
      <h2 class="text-lg font-semibold text-white">${t.name}</h2>
      <div class="mt-3 flex items-baseline gap-3">
        <div class="flex items-baseline gap-1">
          <span class="text-4xl font-semibold text-emerald-400">${t.price}</span>
          <span class="text-sm text-slate-400">HBAR</span>
        </div>
        <div class="flex items-baseline gap-1">
          <span class="text-2xl font-semibold text-sky-400">$${t.priceUsd}</span>
          <span class="text-xs text-slate-500">USD</span>
        </div>
      </div>
      <p class="mt-2 text-sm text-slate-400">${t.description}</p>
      <ul class="mt-5 space-y-2 text-sm text-slate-300">
        ${t.capabilities
      .map(
        (c) =>
          `<li class="flex items-start gap-2"><span class="mt-0.5 text-emerald-400">✓</span><span>${c}</span></li>`,
      )
      .join("")}
      </ul>
      <div class="mt-6 flex flex-col gap-2">
        <a href="/ui/passport/request?tier=${t.name.toLowerCase()}"
           class="inline-flex items-center justify-center rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-4 py-2 text-sm font-medium text-emerald-300 hover:bg-emerald-500/20">
          ${t.cta ?? `Mint ${t.name}`} (HBAR)
        </a>
        <div class="flex flex-col gap-1">
          <input type="text" data-stripe-account-id placeholder="Hedera Account ID (0.0.xxxx)"
                 class="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-sky-500 focus:outline-none" />
          <input type="text" data-stripe-agent-name placeholder="Agent name (optional)"
                 class="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-sky-500 focus:outline-none" />
        </div>
        <button type="button" data-product-id="${t.productId}"
                class="stripe-pay-btn inline-flex items-center justify-center rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500 transition-colors">
          Pay with Card
        </button>
        <p class="text-center text-xs text-slate-500">Powered by Stripe</p>
      </div>
    </article>`;

  const upgradeRows = UPGRADE_DELTAS.map(
    (u) =>
      `<tr class="border-t border-slate-800"><td class="py-3 pr-4 text-slate-300">${u.from}</td><td class="py-3 pr-4 text-slate-300">${u.to}</td><td class="py-3 text-emerald-400">+${u.delta} HBAR</td></tr>`,
  ).join("");

  const content = html`
    <section class="rounded-xl border border-slate-800 bg-gradient-to-br from-slate-900 to-slate-950 p-8">
      <span class="inline-block rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-300">Pricing</span>
      <h1 class="mt-4 text-3xl font-semibold text-white sm:text-4xl">Passport Tiers</h1>
      <p class="mt-3 max-w-2xl text-slate-300">
        Pay once, own your identity forever. Prices are in HBAR and settled on Hedera. The fee covers
        the HTS mint transaction and the HCS registration — there are no recurring charges.
      </p>
    </section>

    <section class="mt-10 grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-4">
      ${raw(TIERS.map(tierCard).join(""))}
    </section>

    <section class="mt-12 rounded-xl border border-slate-800 bg-slate-900 p-6">
      <h2 class="text-lg font-semibold text-white">Upgrade pricing</h2>
      <p class="mt-2 text-sm text-slate-400">
        Already minted? Pay only the difference to upgrade. Your existing passport is updated
        in place; the DID and serial number stay the same.
      </p>
      <table class="mt-4 w-full text-sm">
        <thead class="text-left text-slate-400">
          <tr><th class="pb-2 pr-4 font-medium">From</th><th class="pb-2 pr-4 font-medium">To</th><th class="pb-2 font-medium">Cost</th></tr>
        </thead>
        <tbody>${raw(upgradeRows)}</tbody>
      </table>
    </section>

    <section class="mt-8 grid grid-cols-1 gap-4 md:grid-cols-3">
      <div class="rounded-lg border border-slate-800 bg-slate-900 p-5">
        <h3 class="text-sm font-semibold text-white">Hedera network fees</h3>
        <p class="mt-2 text-sm text-slate-400">~0.001 HBAR per transaction. Included in the tier price.</p>
      </div>
      <div class="rounded-lg border border-slate-800 bg-slate-900 p-5">
        <h3 class="text-sm font-semibold text-white">Mirror Node reads</h3>
        <p class="mt-2 text-sm text-slate-400">Free. No account or signature required for verification.</p>
      </div>
      <div class="rounded-lg border border-slate-800 bg-slate-900 p-5">
        <h3 class="text-sm font-semibold text-white">x402 facilitator fee</h3>
        <p class="mt-2 text-sm text-slate-400">0.3% of payment amount, paid to <a href="https://api.testnet.blocky402.com" class="text-emerald-400 underline hover:text-emerald-300" target="_blank" rel="noopener">blocky402</a>.</p>
      </div>
    </section>

    <section class="mt-10 rounded-xl border border-slate-800 bg-slate-900 p-6">
      <h2 class="text-lg font-semibold text-white">Comparison with alternatives</h2>
      <p class="mt-2 text-sm text-slate-400">Why pay in HBAR for a passport instead of running your own identity stack?</p>
      <div class="mt-4 overflow-x-auto">
        <table class="w-full text-sm">
          <thead class="text-left text-slate-400">
            <tr>
              <th class="pb-3 pr-4 font-medium">Feature</th>
              <th class="pb-3 pr-4 font-medium text-emerald-300">AgentBadge</th>
              <th class="pb-3 pr-4 font-medium">Self-hosted DID</th>
              <th class="pb-3 font-medium">Centralized registry</th>
            </tr>
          </thead>
          <tbody class="text-slate-300">
            <tr class="border-t border-slate-800">
              <td class="py-3 pr-4">On-chain identity</td>
              <td class="py-3 pr-4 text-emerald-400">✓ HTS NFT</td>
              <td class="py-3 pr-4">✓ your chain</td>
              <td class="py-3">✗</td>
            </tr>
            <tr class="border-t border-slate-800">
              <td class="py-3 pr-4">Discoverability</td>
              <td class="py-3 pr-4 text-emerald-400">✓ public HCS directory</td>
              <td class="py-3 pr-4">✗</td>
              <td class="py-3">✓</td>
            </tr>
            <tr class="border-t border-slate-800">
              <td class="py-3 pr-4">Custody</td>
              <td class="py-3 pr-4 text-emerald-400">non-custodial</td>
              <td class="py-3 pr-4">non-custodial</td>
              <td class="py-3">custodial</td>
            </tr>
            <tr class="border-t border-slate-800">
              <td class="py-3 pr-4">P2P payments</td>
              <td class="py-3 pr-4 text-emerald-400">✓ native HBAR</td>
              <td class="py-3 pr-4">manual</td>
              <td class="py-3">✓</td>
            </tr>
            <tr class="border-t border-slate-800">
              <td class="py-3 pr-4">MCP integration</td>
              <td class="py-3 pr-4 text-emerald-400">✓ 38 tools</td>
              <td class="py-3 pr-4">✗</td>
              <td class="py-3">✗</td>
            </tr>
            <tr class="border-t border-slate-800">
              <td class="py-3 pr-4">Transaction cost</td>
              <td class="py-3 pr-4 text-emerald-400">~$0.001</td>
              <td class="py-3 pr-4">gas varies</td>
              <td class="py-3">$0</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <script src="/js/payment.js" defer></script>

    <section class="mt-8 rounded-lg border border-slate-800 bg-slate-900 p-6 text-center">
      <p class="text-slate-300">Questions about pricing?</p>
      <p class="mt-2 text-sm text-slate-400">
        See <a href="/faq" class="text-emerald-400 underline hover:text-emerald-300">FAQ</a> or the
        <a href="/agent-guide" class="text-emerald-400 underline hover:text-emerald-300">Agent Guide</a> for
        step-by-step instructions.
      </p>
    </section>
  `;

  return Layout(content.toString(), PageMeta["/pricing"].title, PageMeta["/pricing"], jsonLd);
}
