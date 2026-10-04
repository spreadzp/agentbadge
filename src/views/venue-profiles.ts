/**
 * SLICE-152-6: provider profile views.
 *
 * - venueProviderCard      — card for /market/providers grid
 * - venueProviderDetailPage — /market/providers/:address
 *   (identity + stats + offers + recent jobs)
 */
import { html, raw } from "hono/html";
import { Layout } from "./layout";
import type { PageMeta } from "../server/lib/page-meta";
import type {
  ProviderProfile,
  ProviderSummary,
} from "../server/lib/venue/profiles";
import type { VenueNetwork } from "../server/lib/venue/chain";
import {
  esc,
  shortAddr,
  jobStatusBadge,
  relTime,
  VENUE_CARD,
} from "./venue-ui";

const AGENT_CHIP =
  "rounded-full bg-slate-800 px-2 py-0.5 text-xs font-mono text-emerald-400";

/** Provider card for the /market/providers grid (152-6). */
export function venueProviderCard(p: ProviderSummary): string {
  return `
  <a href="/market/providers/${esc(p.address)}" class="${VENUE_CARD} block hover:border-emerald-700/50 transition-colors">
    <div class="flex items-start justify-between gap-2">
      <h3 class="text-base font-semibold text-slate-100">${esc(p.name ?? shortAddr(p.address))}</h3>
      ${p.agentId != null ? `<span class="${AGENT_CHIP}" title="ERC-8004 agentId">#${p.agentId}</span>` : ""}
    </div>
    <p class="mt-1 font-mono text-xs text-slate-500">${esc(p.address)}</p>
    <div class="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
      <div><div class="text-lg font-semibold text-slate-100">${p.jobsDone}</div><div class="text-slate-500">jobs done</div></div>
      <div><div class="text-lg font-semibold text-slate-100">${p.feedbackScore}</div><div class="text-slate-500">feedback</div></div>
      <div><div class="text-lg font-semibold text-slate-100">${p.offersActive}</div><div class="text-slate-500">offers</div></div>
    </div>
    <div class="mt-3 border-t border-slate-800 pt-3 text-xs text-slate-500">
      ${p.jobsActive > 0 ? `<span class="text-sky-400">${p.jobsActive} active</span> · ` : ""}${p.lastActiveAt ? `active ${relTime(p.lastActiveAt)}` : "no activity"}
    </div>
  </a>`;
}

/** /market/providers/:address — full provider profile. */
export function venueProviderDetailPage(
  p: ProviderProfile,
  net: VenueNetwork,
): string {
  const stat = (label: string, value: string | number) => `
    <div class="${VENUE_CARD} text-center">
      <div class="text-2xl font-bold text-slate-100">${esc(value)}</div>
      <div class="mt-1 text-xs text-slate-500">${label}</div>
    </div>`;

  const jobRow = (j: ProviderProfile["recentJobs"][number]) => `
    <div class="flex items-center justify-between gap-3 border-b border-slate-800/60 py-2 text-sm last:border-0">
      <a href="/market/jobs/${esc(j.jobId)}" class="text-slate-200 hover:text-emerald-300">${esc(j.title || j.jobId)}</a>
      <span class="flex items-center gap-2">${raw(jobStatusBadge(j.status))}<span class="text-xs text-slate-500">${relTime(j.createdAt)}</span></span>
    </div>`;

  const offerRow = (o: ProviderProfile["offers"][number]) => `
    <div class="flex items-center justify-between gap-3 border-b border-slate-800/60 py-2 text-sm last:border-0">
      <div>
        <span class="text-slate-200">${esc(o.name)}</span>
        ${o.priceUsdc != null ? `<span class="ml-2 text-xs text-emerald-400">$${o.priceUsdc} USDC</span>` : ""}
      </div>
      <span class="text-xs ${o.active ? "text-emerald-400" : "text-slate-500"}">${o.active ? "active" : "inactive"}</span>
    </div>`;

  const body = html`
    <main class="mx-auto max-w-4xl px-4 py-12">
      <a href="/market/providers" class="text-sm text-slate-500 hover:text-slate-300">← providers</a>
      <div class="mt-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 class="text-2xl font-bold">
            ${p.offers[0]?.name ?? shortAddr(p.address)}
            ${p.agentId != null ? raw(`<span class="${AGENT_CHIP} ml-2" title="ERC-8004 agentId">#${p.agentId}</span>`) : ""}
          </h1>
          <a class="mt-1 block font-mono text-sm text-sky-400 hover:underline" target="_blank" href="${net.explorerAddr(p.address)}">${p.address}</a>
        </div>
        <span class="rounded-full border border-slate-700 px-3 py-1 text-xs text-slate-400">
          reputation: ${p.stats.feedbackSource === "onchain" ? "onchain registry" : "venue index"}
        </span>
      </div>

      ${p.owner || p.metadataURI
      ? raw(`<div class="${VENUE_CARD} mt-6 text-sm">
            <h2 class="text-xs font-semibold uppercase tracking-wide text-slate-500">ERC-8004 identity</h2>
            <dl class="mt-2 space-y-1 font-mono text-xs text-slate-400">
              ${p.owner ? `<div>owner&nbsp;<a class="text-sky-400 hover:underline" target="_blank" href="${net.explorerAddr(p.owner)}">${esc(p.owner)}</a></div>` : ""}
              ${p.metadataURI ? `<div>tokenURI&nbsp;<a class="text-sky-400 hover:underline" target="_blank" href="${esc(p.metadataURI)}">${esc(p.metadataURI)}</a></div>` : ""}
            </dl>
          </div>`)
      : ""}

      <div class="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        ${raw(stat("jobs done", p.stats.jobsDone))}
        ${raw(stat("rejected", p.stats.jobsRejected))}
        ${raw(stat("feedback score", p.stats.feedbackScore))}
        ${raw(stat("active offers", p.offers.filter((o) => o.active).length))}
      </div>
      ${p.stats.lastActiveAt ? raw(`<p class="mt-3 text-xs text-slate-500">last active ${relTime(p.stats.lastActiveAt)}</p>`) : ""}

      <section class="mt-8">
        <h2 class="text-sm font-semibold uppercase tracking-wide text-slate-500">Recent jobs</h2>
        <div class="${VENUE_CARD} mt-3 px-4">
          ${p.recentJobs.length === 0
      ? raw(`<p class="py-3 text-sm text-slate-500">No jobs yet.</p>`)
      : raw(p.recentJobs.map(jobRow).join(""))}
        </div>
      </section>

      <section class="mt-8">
        <h2 class="text-sm font-semibold uppercase tracking-wide text-slate-500">Offers</h2>
        <div class="${VENUE_CARD} mt-3 px-4">
          ${p.offers.length === 0
      ? raw(`<p class="py-3 text-sm text-slate-500">No offers published.</p>`)
      : raw(p.offers.map(offerRow).join(""))}
        </div>
      </section>
      <p class="mt-10 text-xs text-slate-500">
        Machine-readable: <code>GET /api/venue/providers/${p.address}</code>
      </p>
    </main>`;
  const meta: PageMeta = {
    title: `${p.offers[0]?.name ?? shortAddr(p.address)} — Provider — Agent Venue`,
    description: `Provider profile on Arc ${net.name}: ERC-8004 identity, venue stats, offers.`,
    path: `/market/providers/${p.address}`,
  };
  return Layout(body as unknown as string, undefined, meta).toString();
}
