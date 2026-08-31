import { html } from "hono/html";
import type { PassportInfo } from "@agentbadge/passport";
import { explorerNftUrl, explorerName } from "../server/lib/chain-ui.js";

/**
 * Full passport detail card — HTML fragment (no <html> wrapper).
 * (SLICE-4-3, hackathon-flow.md:388)
 *
 * Extends the compact card from SLICE-4-1's feed-fragment with full fields:
 * DID, tier, capabilities, owner, issued date, active/revoked status, HashScan link.
 */
export function PassportDetailCard({ info }: { info: PassportInfo }) {
  const hashScanLink = explorerNftUrl(info.tokenId, String(info.serialNumber));
  const dateStr = new Date(info.issuedAt * 1000).toLocaleString();

  return html`<div class="rounded-xl border border-slate-800 bg-slate-900 p-6 max-w-2xl">
    <div class="flex items-center justify-between mb-4">
      <div>
        <span class="text-2xl font-mono text-emerald-400">#${info.serialNumber}</span>
        <span class="text-slate-400 text-sm ml-2">${info.tokenId}</span>
      </div>
      ${info.active
      ? html`<span class="rounded bg-emerald-900 px-3 py-1 text-sm text-emerald-300"
              >ACTIVE</span
            >`
      : html`<span class="rounded bg-red-900 px-3 py-1 text-sm text-red-300">REVOKED</span>`
    }
    </div>

    <dl class="space-y-2 text-sm">
      <div>
        <dt class="text-slate-400 inline">DID:</dt>
        <dd class="text-slate-200 font-mono ml-2 inline">${info.did}</dd>
      </div>
      <div>
        <dt class="text-slate-400 inline">Tier:</dt>
        <dd class="text-emerald-400 ml-2 inline">${info.tier ?? "unknown"}</dd>
      </div>
      <div>
        <dt class="text-slate-400 inline">Owner:</dt>
        <dd class="text-slate-300 font-mono ml-2 inline">${info.owner}</dd>
      </div>
      <div>
        <dt class="text-slate-400 inline">Issued:</dt>
        <dd class="text-slate-300 ml-2 inline">${dateStr}</dd>
      </div>
      ${info.endpoint
      ? html`<div>
              <dt class="text-slate-400 inline">Endpoint:</dt>
              <dd class="text-blue-400 ml-2 inline">${info.endpoint}</dd>
            </div>`
      : ""
    }
      <div>
        <dt class="text-slate-400 inline">Capabilities:</dt>
        <dd class="ml-2 inline">
          ${info.capabilities.map(
      (cap) =>
        html`<span class="rounded bg-slate-800 px-2 py-1 text-xs text-slate-300 mr-1"
                >${cap}</span
              >`,
    )}
        </dd>
      </div>
    </dl>

    <div class="mt-4 pt-4 border-t border-slate-800">
      <a
        href="${hashScanLink}"
        target="_blank"
        class="text-emerald-400 hover:text-emerald-300 text-sm"
        >View on ${explorerName()} ↗</a
      >
    </div>
  </div>`;
}

/**
 * Not-found fragment for missing passports.
 * Returns 200 (HTMX convention — always renderable content).
 */
export function PassportNotFound() {
  return html`<div
    class="rounded-lg border border-slate-800 bg-slate-900 p-6 text-center text-slate-300"
  >
    <p class="text-lg">Passport not found.</p>
    <p class="text-sm mt-2 text-slate-400">The specified tokenId and serial may not exist.</p>
  </div>`;
}
