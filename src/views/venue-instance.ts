/**
 * SLICE-153-1: venue instance views — /market/v/:slug page + hub selector.
 * Kept out of venue-pages.ts (file-size guard, 300-line cap).
 */
import { html, raw } from "hono/html";

import { Layout } from "./layout";
import type { PageMeta } from "../server/lib/page-meta";
import type { VenueNetwork } from "../server/lib/venue/chain";
import type { VenueRecord } from "../server/lib/venue/venues";
import type { VenueJob, VenueOffer } from "../server/lib/venue/store";
import { CARD, esc, venueSelector, venueTabs } from "./venue-ui";
import { venueJobCard } from "./venue-pages";

/** /market/v/:slug — venue landing: meta + scoped jobs/offers preview. */
export function venueInstancePage(
  venue: VenueRecord,
  jobs: VenueJob[],
  offers: VenueOffer[],
  venues: VenueRecord[],
  net: VenueNetwork,
): string {
  const meta: PageMeta = {
    title: `${venue.name} — Agent Venue`,
    description:
      venue.description ??
      `Business venue "${venue.slug}" — scoped ERC-8183 jobs and provider offers on Arc ${net.name}.`,
    path: `/market/v/${venue.slug}`,
  };
  const jobsList = jobs.length
    ? jobs.map((j) => venueJobCard(j, net)).join("")
    : `<div class="${CARD} text-sm text-slate-500">No jobs in this venue yet.</div>`;
  const offersList = offers.length
    ? offers
      .map(
        (o) => `<div class="${CARD}">
            <h3 class="text-base font-semibold text-slate-100">${esc(o.name)}</h3>
            <p class="mt-1 text-sm text-slate-400 line-clamp-2">${esc(o.description)}</p>
            ${o.priceUsdc != null ? `<span class="text-xs text-emerald-400">$${o.priceUsdc} USDC</span>` : ""}
          </div>`,
      )
      .join("")
    : `<div class="${CARD} text-sm text-slate-500">No provider offers yet.</div>`;

  const body = html`
    <main class="mx-auto max-w-6xl px-4 py-12">
      <div class="flex items-center gap-3">
        <h1 class="text-3xl font-bold">${esc(venue.name)}</h1>
        ${venue.kind === "business"
      ? `<span class="rounded-full border border-violet-500/50 bg-violet-500/10 px-2.5 py-0.5 text-xs text-violet-300">business</span>`
      : ""}
        ${!venue.active
      ? `<span class="rounded-full border border-amber-500/50 bg-amber-500/10 px-2.5 py-0.5 text-xs text-amber-300">inactive</span>`
      : ""}
      </div>
      <p class="mt-2 max-w-2xl text-slate-400">
        ${venue.description ? esc(venue.description) : "Private venue namespace — scoped jobs and offers."}
      </p>
      ${raw(venueSelector(venues, venue.slug))}
      <div class="mt-8 grid gap-4 grid-cols-2 sm:grid-cols-3">
        <div class="${CARD} text-center">
          <div class="text-3xl font-bold text-emerald-400">${jobs.length}</div>
          <div class="mt-1 text-xs text-slate-500">jobs</div>
        </div>
        <div class="${CARD} text-center">
          <div class="text-3xl font-bold text-emerald-400">
            ${jobs.filter((j) => j.status === "open").length}
          </div>
          <div class="mt-1 text-xs text-slate-500">open</div>
        </div>
        <div class="${CARD} text-center">
          <div class="text-3xl font-bold text-emerald-400">${offers.length}</div>
          <div class="mt-1 text-xs text-slate-500">offers</div>
        </div>
      </div>
      ${raw(venueTabs("jobs"))}
      <h2 class="mt-8 text-lg font-semibold text-slate-200">Jobs</h2>
      <div class="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">${raw(jobsList)}</div>
      <h2 class="mt-8 text-lg font-semibold text-slate-200">Provider offers</h2>
      <div class="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">${raw(offersList)}</div>
    </main>`;
  return Layout(body as unknown as string, undefined, meta).toString();
}
