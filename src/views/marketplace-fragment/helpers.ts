import { html } from "hono/html";
import type { MarketTask } from "../../server/lib/market-task.js";
import { explorerTxUrl, explorerName } from "../../server/lib/chain-ui.js";

/**
 * Detect content type of resultBody and render accordingly:
 * - HTML → iframe with srcdoc
 * - JSON → formatted <pre>
 * - Text/Markdown → <pre> with wrapping
 */
export function renderResultBody(body: string): string {
  const trimmed = body.trim();

  if (
    trimmed.startsWith("<!DOCTYPE") ||
    trimmed.startsWith("<html") ||
    (trimmed.startsWith("<") && trimmed.includes("<body"))
  ) {
    return `<div class="mt-2 rounded-lg border border-slate-700 bg-white overflow-hidden">
      <iframe srcdoc="${body.replace(/"/g, "&quot;")}" class="w-full h-[600px] border-0" sandbox="allow-same-origin" title="Delivery Result (HTML)"></iframe>
    </div>`;
  }

  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      return `<pre class="mt-2 overflow-x-auto rounded bg-slate-950 p-3 text-xs text-slate-300"><code>${JSON.stringify(parsed, null, 2)}</code></pre>`;
    } catch {
      // Not valid JSON
    }
  }

  return `<pre class="mt-2 overflow-x-auto rounded bg-slate-950 p-3 text-xs text-slate-300 whitespace-pre-wrap">${body}</pre>`;
}

export const PAGE_SIZE = 4;

export function shortDid(did: string): string {
  return did.length > 16 ? `…${did.slice(-12)}` : did;
}

export function relativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp * 1000;
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}


export function explorerLinks(txId?: string, color: string = "emerald"): ReturnType<typeof html> | string {
  if (!txId) return html`<span class="text-xs text-slate-600 italic">pending</span>`;
  const url = explorerTxUrl(txId);
  return html`<div class="flex items-center gap-1">
    <a
      href="${url}"
      target="_blank"
      rel="noopener"
      title="View transaction on ${explorerName()}"
      class="text-${color}-500 hover:text-${color}-400 transition-colors"
      aria-label="View on ${explorerName()}"
    >
      <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
    </a>
    <button
      type="button"
      title="Copy ${explorerName()} link"
      class="text-${color}-500 hover:text-${color}-400 transition-colors cursor-pointer"
      aria-label="Copy ${explorerName()} link"
      onclick="navigator.clipboard.writeText('${url}').then(()=>{this.textContent='✓';setTimeout(()=>{this.textContent='⧉'},1500)})"
    >
      <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" /></svg>
    </button>
  </div>`;
}

export function statusBadge(status: MarketTask["status"]) {
  const colors: Record<string, string> = {
    posted: "bg-emerald-900 text-emerald-300 border-emerald-700",
    claimed: "bg-amber-900 text-amber-300 border-amber-700",
    delivered: "bg-blue-900 text-blue-300 border-blue-700",
    completed: "bg-slate-700 text-slate-300 border-slate-600",
  };
  return html`<span class="px-2 py-0.5 rounded text-xs font-medium border ${colors[status] ?? colors.completed}">${status}</span>`;
}
