/**
 * Venue feed + stub views (SLICE-151-12).
 * Extracted from venue-pages.ts to keep files under max-lines.
 *
 * - venueActivityFragment — "Recent activity" list for the hub (D-F9)
 * - venueStubPage         — "coming soon" tabs services/passes (D-F12)
 */

import { html, raw } from "hono/html";
import { Layout } from "./layout";
import type { PageMeta } from "../server/lib/page-meta";
import type { VenueNetwork } from "../server/lib/venue/chain";
import { CARD, esc, relTime, shortHash, venueTabs } from "./venue-ui";

// ─── Recent activity feed (D-F9) ─────────────────────────────────

export interface VenueActivityViewItem {
  action: string;
  text: string;
  at: string;
  tx?: string;
  jobId?: string;
}

const ACTION_ICON: Record<string, string> = {
  "job.created": "＋",
  "job.tx": "⛓",
  "job.status": "→",
  "offer.registered": "★",
  "attestation.minted": "✔",
};

export function venueActivityFragment(
  items: VenueActivityViewItem[],
  net: VenueNetwork,
): string {
  if (items.length === 0) {
    return `<div class="rounded-lg border border-slate-800 bg-slate-900 p-6 text-center text-sm text-slate-500">
      No activity yet — first job or provider registration lands here.</div>`;
  }
  const rows = items
    .map((it) => {
      const icon = ACTION_ICON[it.action] ?? "•";
      const link = it.tx
        ? `<a href="${net.explorerTx(it.tx)}" target="_blank" rel="noopener" class="ml-2 font-mono text-xs text-sky-400 hover:underline">${shortHash(it.tx)} ⧉</a>`
        : it.jobId
          ? `<a href="/market/jobs/${esc(it.jobId)}" class="ml-2 text-xs text-sky-400 hover:underline">job →</a>`
          : "";
      return `<li class="flex items-start gap-3 py-2 border-b border-slate-800/60 last:border-0">
        <span class="w-5 shrink-0 text-center text-emerald-400" aria-hidden="true">${icon}</span>
        <span class="min-w-0 flex-1 text-sm text-slate-300">${esc(it.text)}${link}</span>
        <span class="shrink-0 text-xs text-slate-500">${esc(relTime(it.at))}</span>
      </li>`;
    })
    .join("");
  return `<ul>${rows}</ul>`;
}

// ─── /market/services + /market/passes stubs (D-F12) ─────────────

const STUB_COPY: Record<
  "services" | "passes",
  { title: string; blurb: string }
> = {
  services: {
    title: "Services",
    blurb:
      "The services catalog moves under this tab soon — browse what agents " +
      "sell, priced in USDC. Until then, see the live providers board and " +
      "the market guide.",
  },
  passes: {
    title: "Passes",
    blurb:
      "ServicePass NFT mints will be listed here — proof an agent holds " +
      "paid access. The first passes already exist on Arc mainnet; " +
      "the listing UI ships next.",
  },
};

export function venueStubPage(
  tab: "services" | "passes",
  net: VenueNetwork,
): string {
  const copy = STUB_COPY[tab];
  const body = html`
    <main class="mx-auto max-w-6xl px-4 py-12">
      <h1 class="text-3xl font-bold">${esc(copy.title)}</h1>
      ${raw(venueTabs(tab))}
      <div class="${CARD} mt-8 text-center">
        <div class="text-5xl" aria-hidden="true">⏳</div>
        <h2 class="mt-4 text-xl font-semibold text-slate-200">Coming soon</h2>
        <p class="mx-auto mt-3 max-w-xl text-sm text-slate-400">${esc(copy.blurb)}</p>
        <div class="mt-6 flex flex-wrap justify-center gap-3">
          <a href="/market/providers" class="rounded-lg border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-200 hover:border-emerald-500/40">Providers board →</a>
          <a href="/market-guide" class="rounded-lg border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-200 hover:border-emerald-500/40">Market guide →</a>
        </div>
      </div>
      <p class="mt-8 text-xs text-slate-500">Arc ${esc(net.name)} · venue tabs share the same live store</p>
    </main>`;
  const meta: PageMeta = {
    title: `${copy.title} — Agent Venue`,
    description: copy.blurb,
    path: `/market/${tab}`,
  };
  return Layout(body as unknown as string, undefined, meta).toString();
}
