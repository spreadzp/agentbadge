import { html } from "hono/html";
import type { AuditMessage } from "@agentgate-hedera/hedera-core";

/** Audit event with on-chain consensus timestamp from Mirror Node. */
export interface AuditEventWithTx extends AuditMessage {
  consensusTimestamp?: string;
}

/**
 * Render a single audit event row.
 * (SLICE-4-2, hackathon-flow.md:127 — polls every 5s)
 */
function AuditRow({ event }: { event: AuditEventWithTx }) {
  const dateStr = new Date(event.timestamp * 1000).toLocaleString();

  const typeColors: Record<string, string> = {
    passport_issued: "text-emerald-400",
    tier_upgraded: "text-blue-400",
    passport_revoked: "text-red-400",
    agent_registered: "text-emerald-400",
    agent_deregistered: "text-amber-400",
  };

  const colorClass = typeColors[event.type] ?? "text-slate-300";

  const network = process.env.HEDERA_NETWORK ?? "testnet";
  const hashScanUrl = event.consensusTimestamp
    ? `https://hashscan.io/${network}/transaction/${event.consensusTimestamp}`
    : null;

  return html`<div class="rounded-lg border border-slate-800 bg-slate-900 p-3 text-sm">
    <div class="flex items-center justify-between">
      <span class="${colorClass} font-medium">${event.type}</span>
      <div class="flex items-center gap-2">
        ${hashScanUrl
      ? html`<div class="flex items-center gap-1">
                <a
                  href="${hashScanUrl}"
                  target="_blank"
                  rel="noopener"
                  title="View transaction on HashScan"
                  class="text-slate-500 hover:text-emerald-400 transition-colors"
                  aria-label="View on HashScan"
                >
                  <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                </a>
                <button
                  type="button"
                  title="Copy HashScan link"
                  class="text-slate-500 hover:text-emerald-400 transition-colors cursor-pointer"
                  aria-label="Copy HashScan link"
                  onclick="navigator.clipboard.writeText('${hashScanUrl}').then(()=>{this.textContent='✓';setTimeout(()=>{this.textContent='⧉'},1500)})"
                >
                  <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" /></svg>
                </button>
              </div>`
      : ""
    }
        <span class="text-slate-400 text-xs">${dateStr}</span>
      </div>
    </div>
    <div class="mt-1 text-slate-300 font-mono text-xs">${event.did}</div>
    ${event.type === "tier_upgraded" && event.oldTier && event.newTier
      ? html`<div class="mt-1 text-slate-300">
            <span class="text-slate-400">Tier:</span>
            <span class="text-slate-300">${event.oldTier}</span>
            →
            <span class="text-emerald-400">${event.newTier}</span>
          </div>`
      : ""
    }
    ${event.type === "passport_revoked" && event.reason
      ? html`<div class="mt-1 text-slate-300">
            <span class="text-slate-400">Reason:</span>
            <span class="text-red-400">${event.reason}</span>
          </div>`
      : ""
    }
    ${event.tier ? html`<div class="mt-1 text-slate-400 text-xs">Tier: ${event.tier}</div>` : ""}
  </div>`;
}

/**
 * Render the audit stream fragment (no <html> wrapper — HTMX swap content).
 * (SLICE-4-2, hackathon-flow.md:127 — polls every 5s)
 *
 * @param events  Audit events, most recent first
 */
export function AuditFragment({ events }: { events: AuditEventWithTx[] }) {
  if (events.length === 0) {
    return html`<div
      class="rounded-lg border border-slate-800 bg-slate-900 p-6 text-center text-slate-300"
    >
      <p>No audit events yet.</p>
      <p class="text-sm mt-2 text-slate-400">
        State changes will appear here as they happen on-chain.
      </p>
    </div>`;
  }

  // Most recent first
  const sorted = [...events].reverse();

  const PAGE_SIZE = 4;
  const visible = sorted.slice(0, PAGE_SIZE);
  const hidden = sorted.slice(PAGE_SIZE);

  return html`<div class="space-y-2"
    >${visible.map((event) => AuditRow({ event }))}${hidden.map(
    (event) =>
      html`<div class="hidden" data-paginated="true">${AuditRow({ event })}</div>`,
  )}</div
  >${hidden.length > 0
      ? html`<button
        type="button"
        onclick="showMore(this, ${PAGE_SIZE})"
        class="mt-3 w-full rounded-lg border border-slate-700 bg-slate-800 py-2 text-sm text-slate-300 hover:bg-slate-700 transition-colors"
      >
        Show more (<span class="show-more-remaining">${hidden.length}</span> remaining)
      </button>`
      : ""}`;
}
