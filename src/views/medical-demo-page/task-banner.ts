import { html, raw } from "hono/html";
import type { CachedMarketTask } from "@agentbadge/hedera-core";
import { renderResultBody } from "./result-body";

/**
 * Task banner — shows live marketplace task data when the demo page is opened
 * for a specific task (`/ui/medical-demo/:taskId`).
 */
export function TaskBanner(task: CachedMarketTask) {
  const statusColors: Record<string, string> = {
    posted: "bg-emerald-900 text-emerald-300 border-emerald-700",
    claimed: "bg-amber-900 text-amber-300 border-amber-700",
    delivered: "bg-blue-900 text-blue-300 border-blue-700",
    completed: "bg-slate-700 text-slate-300 border-slate-600",
  };
  const color = statusColors[task.status] ?? statusColors.completed;

  return html`<section
    class="mt-4 rounded-lg border border-slate-700 bg-slate-900 p-5"
  >
    <div class="flex items-center justify-between gap-4">
      <div class="min-w-0">
        <div class="flex items-center gap-2">
          <h2 class="text-lg font-semibold text-white truncate">${task.title}</h2>
          <span class="px-2 py-0.5 rounded text-xs font-medium border ${color}">${task.status}</span>
        </div>
        <p class="mt-1 text-sm text-slate-400 line-clamp-2">${task.description}</p>
      </div>
      <div class="shrink-0 text-right">
        <div class="text-lg font-bold text-emerald-400">${task.priceHbar} HBAR</div>
        <div class="text-xs text-slate-500">${task.capabilities.join(", ")}</div>
      </div>
    </div>
    <div class="mt-4 grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
      <div>
        <span class="text-slate-500">Task ID</span>
        <div class="mt-0.5 flex items-center gap-1">
          <span class="font-mono text-slate-300 truncate">${task.taskId}</span>
          <button
            type="button"
            title="Copy Task ID"
            class="text-slate-600 hover:text-emerald-400 transition-colors cursor-pointer shrink-0"
            onclick="navigator.clipboard.writeText('${task.taskId}').then(()=>{this.textContent='✓';setTimeout(()=>{this.textContent='⧉'},1500)})"
          >⧉</button>
        </div>
      </div>
      <div>
        <span class="text-slate-500">Poster DID</span>
        <div class="mt-0.5 font-mono text-slate-300 truncate" title="${task.posterDid}">${task.posterDid}</div>
      </div>
      <div>
        <span class="text-slate-500">Claimed by</span>
        <div class="mt-0.5 font-mono text-slate-300 truncate" title="${task.claimerDid ?? "—"}">${task.claimerDid ?? "—"}</div>
      </div>
      <div>
        <span class="text-slate-500">Created</span>
        <div class="mt-0.5 text-slate-300">${new Date(task.createdAt * 1000).toLocaleString()}</div>
      </div>
    </div>
    ${task.resultBody || task.resultIpfs
      ? html`<div class="mt-3 rounded-lg border border-blue-500/30 bg-blue-500/5 p-3">
          <div class="flex items-center justify-between">
            <h3 class="text-sm font-semibold text-blue-300">Delivery Result</h3>
            ${task.resultBody
          ? html`<a
                  href="/ui/market/tasks/${task.taskId}/result"
                  target="_blank"
                  rel="noopener"
                  class="inline-flex items-center gap-1.5 text-xs text-emerald-400 hover:text-emerald-300"
                >
                  <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                  Open in new tab
                </a>`
          : ""}
          </div>
          ${task.resultBody
          ? raw(renderResultBody(task.resultBody))
          : ""}
          ${task.resultIpfs
          ? html`<div class="mt-2">
                <p class="text-xs text-slate-400">Full report (IPFS):</p>
                <a href="${task.resultIpfs}" target="_blank" rel="noopener" class="text-sm text-blue-400 hover:underline break-all">${task.resultIpfs}</a>
              </div>`
          : ""}
        </div>`
      : ""}
    <div class="mt-3 flex items-center gap-3">
      <a
        href="/ui/market/tasks/${task.taskId}"
        class="text-xs text-blue-400 hover:text-blue-300"
      >View Task Details →</a>
      ${task.status === "posted"
      ? html`<button
            class="text-xs text-emerald-400 hover:text-emerald-300"
            hx-post="/market/tasks/${task.taskId}/claim"
            hx-swap="outerHTML"
          >Claim this task</button>`
      : ""}
    </div>
  </section>`;
}
