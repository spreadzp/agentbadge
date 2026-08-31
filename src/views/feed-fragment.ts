import { html } from "hono/html";
import type { NftInfo } from "@agentbadge/hedera-core";
import { explorerNftUrl, explorerName } from "../server/lib/chain-ui.js";

/**
 * Render a single passport card as an HTML fragment.
 * (SLICE-4-1, hackathon-flow.md:385-391)
 *
 * Reused by SLICE-4-3's passport-card.ts for the full detail view.
 */
export function PassportCard({ nft }: { nft: NftInfo }) {
  const serial = nft.serial_number;
  const tokenId = nft.token_id;
  const owner = nft.account_id;
  const timestamp = nft.created_timestamp;
  const dateStr = new Date(parseFloat(timestamp) * 1000).toLocaleString();

  const hashScanUrl = explorerNftUrl(tokenId, String(serial));

  return html`<div
    class="rounded-lg border border-slate-800 bg-slate-900 p-4 hover:border-slate-600 transition-colors"
  >
    <div class="flex items-center justify-between">
      <div>
        <span class="text-lg font-mono text-emerald-400">#${serial}</span>
        <span class="text-slate-400 text-sm ml-2">${tokenId}</span>
      </div>
      <div class="flex items-center gap-2">
        <div class="flex items-center gap-1">
          <a
            href="${hashScanUrl}"
            target="_blank"
            rel="noopener"
            title="View NFT on ${explorerName()}"
            class="inline-flex min-h-6 min-w-6 items-center justify-center p-1 text-slate-400 hover:text-emerald-400 transition-colors"
            aria-label="View on ${explorerName()}"
          >
            <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
          </a>
          <button
            type="button"
            title="Copy ${explorerName()} link"
            class="inline-flex min-h-6 min-w-6 items-center justify-center p-1 text-slate-400 hover:text-emerald-400 transition-colors cursor-pointer"
            aria-label="Copy ${explorerName()} link"
            onclick="navigator.clipboard.writeText('${hashScanUrl}').then(()=>{this.textContent='✓';setTimeout(()=>{this.textContent='⧉'},1500)})"
          >
            <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" /></svg>
          </button>
        </div>
        ${nft.deleted
      ? html`<span class="rounded bg-red-900 px-2 py-1 text-xs text-red-300">REVOKED</span>`
      : html`<span class="rounded bg-emerald-900 px-2 py-1 text-xs text-emerald-300"
                >ACTIVE</span
              >`
    }
      </div>
    </div>
    <div class="mt-2 text-sm text-slate-300">
      <span>Owner: ${owner}</span>
    </div>
    <div class="mt-1 text-sm text-slate-400">
      <span>Issued: ${dateStr}</span>
    </div>
  </div>`;
}

/**
 * Render the passport feed fragment (no <html> wrapper — HTMX swap content).
 * (SLICE-4-1, hackathon-flow.md:122-132)
 *
 * @param nfts  NFTs from Mirror Node, most recent first
 */
const PAGE_SIZE = 4;

export function FeedFragment({ nfts }: { nfts: NftInfo[] }) {
  if (nfts.length === 0) {
    return html`<div
      class="rounded-lg border border-slate-800 bg-slate-900 p-6 text-center text-slate-300"
    >
      <p>No passports issued yet.</p>
      <p class="text-sm mt-2 text-slate-400">New passports will appear here automatically.</p>
    </div>`;
  }

  const visible = nfts.slice(0, PAGE_SIZE);
  const remaining = nfts.length - PAGE_SIZE;

  return html`<div class="space-y-3"
    >${visible.map((nft) => PassportCard({ nft }))}</div
  >${remaining > 0
      ? html`<button
        type="button"
        hx-get="/ui/feed?offset=${PAGE_SIZE}"
        hx-target="this"
        hx-swap="outerHTML"
        class="mt-3 w-full rounded-lg border border-slate-700 bg-slate-800 py-2 text-sm text-slate-300 hover:bg-slate-700 transition-colors"
      >
        Show more (${remaining} remaining)
      </button>`
      : ""}`;
}
