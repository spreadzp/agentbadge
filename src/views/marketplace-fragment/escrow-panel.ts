import { html } from "hono/html";
import type { MarketTask } from "../../server/lib/market-task.js";
import { explorerTxUrl, explorerName } from "../../server/lib/chain-ui.js";

function escrowStatusBadge(status: string): ReturnType<typeof html> {
  const colors: Record<string, string> = {
    none: "bg-slate-700 text-slate-400 border-slate-600",
    pending: "bg-amber-900 text-amber-300 border-amber-700",
    released: "bg-emerald-900 text-emerald-300 border-emerald-700",
    cancelled: "bg-red-900 text-red-300 border-red-700",
    expired: "bg-red-900 text-red-300 border-red-700",
  };
  const color = colors[status] ?? colors.none;
  const label = status === "none" ? "no escrow" : status;
  return html`<span class="px-2 py-0.5 rounded text-xs font-medium border ${color}">${label}</span>`;
}

export function EscrowPanel(task: MarketTask, viewerDid?: string): ReturnType<typeof html> | string {
  const escrowStatus = task.escrowStatus ?? "none";
  const scheduleId = task.scheduleId;
  const isPoster = viewerDid === task.posterDid;
  const escrowUrl = scheduleId
    ? explorerTxUrl(scheduleId)
    : null;

  // Only show panel if there's an escrow or schedule
  if (escrowStatus === "none" && !scheduleId) return "";

  const pollUrl = `/ui/market/tasks/${task.id}/escrow-fragment${viewerDid ? `?did=${encodeURIComponent(viewerDid)}` : ""}`;

  return html`<div
    class="rounded-lg border border-slate-700 bg-slate-900 p-4 space-y-3"
    hx-get="${pollUrl}"
    hx-trigger="every 5s"
    hx-swap="outerHTML"
  >
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-2">
        <svg class="h-4 w-4 text-amber-400" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 15v2m-6 4h12a2 2 0 0012-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
        <h3 class="text-sm font-semibold text-white">Escrow Status</h3>
      </div>
      ${escrowStatusBadge(escrowStatus)}
    </div>
    <div class="grid grid-cols-2 gap-3 text-xs">
      <div>
        <span class="text-slate-500">Scheduled TX:</span>
        <div class="mt-0.5 font-mono text-slate-300 truncate" title="${scheduleId ?? "—"}">${scheduleId ?? "—"}</div>
      </div>
      <div>
        <span class="text-slate-500">Amount:</span>
        <div class="mt-0.5 text-emerald-400 font-medium">${task.price}</div>
      </div>
      ${escrowUrl
      ? html`<div class="col-span-2">
            <a href="${escrowUrl}" target="_blank" rel="noopener" class="inline-flex items-center gap-1 text-blue-400 hover:text-blue-300">
              <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
              View on ${explorerName()}
            </a>
          </div>`
      : ""}
    </div>
    ${isPoster && escrowStatus === "pending" && task.status === "delivered"
      ? html`<div class="flex items-center gap-2 pt-2 border-t border-slate-800">
            <button
              class="px-3 py-1.5 bg-emerald-700 hover:bg-emerald-600 text-white rounded-lg text-xs font-medium"
              hx-post="/market/tasks/${task.id}/complete"
              hx-swap="outerHTML"
            >
              Sign & Release
            </button>
            <button
              class="px-3 py-1.5 bg-red-800 hover:bg-red-700 text-white rounded-lg text-xs font-medium"
              hx-post="/market/tasks/${task.id}/cancel"
              hx-swap="outerHTML"
            >
              Cancel & Refund
            </button>
          </div>`
      : ""}
    ${isPoster && escrowStatus === "pending" && task.status === "posted"
      ? html`<div class="flex items-center gap-2 pt-2 border-t border-slate-800">
            <button
              class="px-3 py-1.5 bg-red-800 hover:bg-red-700 text-white rounded-lg text-xs font-medium"
              hx-post="/market/tasks/${task.id}/cancel"
              hx-swap="outerHTML"
            >
              Cancel & Refund
            </button>
          </div>`
      : ""}
  </div>`;
}
