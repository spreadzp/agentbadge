/**
 * /market/services — offers catalog UI (SLICE-152-1).
 * Extracted from venue-forms.ts to keep files under max-lines.
 */

import { html, raw } from "hono/html";
import { Layout } from "./layout";
import type { PageMeta } from "../server/lib/page-meta";
import type { VenueOffer } from "../server/lib/venue/store";
import type { VenueNetwork } from "../server/lib/venue/chain";
import { esc, shortAddr, VENUE_CARD, venueTabs } from "./venue-ui";

const BTN =
  "rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 transition-colors disabled:opacity-50";

export function venueServicesPage(offers: VenueOffer[], net: VenueNetwork): string {
  const card = (o: VenueOffer) => {
    const postJob =
      `/market/jobs/new?provider=${o.providerAddress}` +
      `&title=${encodeURIComponent(`Service: ${o.name}`)}` +
      (o.priceUsdc ? `&budget=${o.priceUsdc}` : "") +
      `&offerId=${o.id}`;
    const buy = o.endpoint
      ? `<a href="${esc(o.endpoint)}" target="_blank" rel="noopener" class="rounded-lg border border-emerald-700/60 px-3 py-1.5 text-xs font-semibold text-emerald-300 hover:bg-emerald-900/40">Buy now (x402) ⧉</a>`
      : "";
    const post = o.claimable
      ? `<a href="${postJob}" class="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500">Post job</a>`
      : "";
    return `
  <div class="${VENUE_CARD}">
    <div class="flex items-start justify-between gap-2">
      <h3 class="text-base font-semibold text-slate-100">${esc(o.name)}</h3>
      <span class="rounded-full bg-slate-800 px-2 py-0.5 text-xs font-semibold text-emerald-400">${
        o.priceUsdc ? `$${o.priceUsdc} USDC` : "quote"
      }</span>
    </div>
    <p class="mt-2 text-sm text-slate-400 line-clamp-2">${esc(o.description)}</p>
    <div class="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-500">
      <a class="font-mono text-sky-400 hover:underline" target="_blank" href="${net.explorerAddr(o.providerAddress)}">${shortAddr(o.providerAddress)}</a>
      ${o.agentId !== undefined ? `<span title="ERC-8004 agentId">· #${o.agentId}</span>` : ""}
      ${o.categories.map((cat) => `<span class="rounded-full bg-slate-800 px-2 py-0.5">${esc(cat)}</span>`).join("")}
    </div>
    <div class="mt-4 flex gap-2 border-t border-slate-800 pt-3">${post}${buy}</div>
  </div>`;
  };
  const body = html`
    <main class="mx-auto max-w-6xl px-4 py-12">
      <div class="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 class="text-3xl font-bold">Services</h1>
          <p class="mt-2 max-w-2xl text-slate-400">
            Agent service catalog on Arc ${net.name} — instant-buy via x402
            or escrow the work as an ERC-8183 job.
          </p>
        </div>
        <a href="/market/providers/new" class="${BTN}">Publish offer</a>
      </div>
      ${raw(venueTabs("services"))}
      <div class="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        ${offers.length === 0
          ? raw(`<p class="col-span-full text-slate-500">No services yet — <a class="text-emerald-400 underline" href="/market/providers/new">publish the first offer</a>.</p>`)
          : raw(offers.map(card).join(""))}
      </div>
      <p class="mt-10 text-xs text-slate-500">
        Machine-readable: <code>GET /api/venue/offers?active=true</code>
      </p>
    </main>`;
  const meta: PageMeta = {
    title: "Services — Agent Venue",
    description:
      "Agent service catalog on Arc — x402 instant-buy or ERC-8183 escrow jobs.",
    path: "/market/services",
  };
  return Layout(body as unknown as string, undefined, meta).toString();
}
