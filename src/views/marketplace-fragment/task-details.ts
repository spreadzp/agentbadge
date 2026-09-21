import { html, raw } from "hono/html";
import type { CachedA2AMessage } from "@agentbadge/hedera-core";
import type { MarketTask } from "../../server/lib/market-task.js";
import { renderResultBody, shortDid, relativeTime, explorerLinks, statusBadge } from "./helpers";
import { EscrowPanel } from "./escrow-panel";
import { VerificationPanel } from "./verification-panel";
import { DataHubLinks } from "./datahub-links";
import { TaskMessagesFragment } from "./task-messages";

export function TaskDetailsFragment(
  task: MarketTask,
  viewerDid?: string,
  messages: CachedA2AMessage[] = [],
) {
  return html`
    <div class="max-w-2xl mx-auto space-y-4">
      <div class="flex items-center justify-between">
        <h2 class="text-xl font-bold text-white">${task.title}</h2>
        ${statusBadge(task.status)}
      </div>
      <p class="text-slate-300">${task.description}</p>
      <div class="grid grid-cols-2 gap-4 text-sm">
        <div>
          <span class="text-slate-500">Task ID:</span>
          <span class="font-mono text-slate-300 text-xs">${task.id}</span>
        </div>
        <div>
          <span class="text-slate-500">Price:</span>
          <span class="text-emerald-400 font-medium">${task.price}</span>
        </div>
        <div>
          <span class="text-slate-500">Posted by:</span>
          <span class="text-slate-300" title="${task.posterDid}">${shortDid(task.posterDid)}</span>
        </div>
        <div>
          <span class="text-slate-500">Capabilities:</span>
          <span class="text-slate-300">${task.capabilities.join(", ")}</span>
        </div>
        <div>
          <span class="text-slate-500">Created:</span>
          <span class="text-slate-300">${relativeTime(task.createdAt)}</span>
        </div>
        ${task.deadline
      ? html`<div>
              <span class="text-slate-500">Deadline:</span>
              <span class="text-slate-300">${relativeTime(task.deadline)}</span>
            </div>`
      : ""}
        ${task.claimerDid
      ? html`<div>
              <span class="text-slate-500">Claimed by:</span>
              <span class="text-slate-300" title="${task.claimerDid}">${shortDid(task.claimerDid)}</span>
            </div>`
      : ""}
      </div>
      <div class="flex flex-wrap items-center gap-4 pt-2">
        <div class="flex items-center gap-1.5">
          <svg class="h-4 w-4 text-emerald-400" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4" /></svg>
          <span class="text-xs text-slate-500">Post TX:</span>
          ${explorerLinks(task.txId, "emerald")}
        </div>
        <div class="flex items-center gap-1.5">
          <svg class="h-4 w-4 text-amber-400" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M7 11l5-5m0 0l5 5m-5-5v12" transform="rotate(180 12 12)" /><path stroke-linecap="round" stroke-linejoin="round" d="M9 12l3 3 3-3" /></svg>
          <span class="text-xs text-slate-500">Claim TX:</span>
          ${explorerLinks(task.claimTxId, "amber")}
        </div>
        <div class="flex items-center gap-1.5">
          <svg class="h-4 w-4 text-blue-400" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" /></svg>
          <span class="text-xs text-slate-500">Deliver TX:</span>
          ${explorerLinks(task.deliverTxId, "blue")}
        </div>
        <div class="flex items-center gap-1.5">
          <svg class="h-4 w-4 text-violet-400" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          <span class="text-xs text-slate-500">Payment TX:</span>
          ${explorerLinks(task.paymentTxId, "violet")}
        </div>
        <div class="flex items-center gap-1.5">
          <svg class="h-4 w-4 text-teal-400" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" /></svg>
          <span class="text-xs text-slate-500">Completed TX:</span>
          ${explorerLinks(task.completedTxId, "teal")}
        </div>
      </div>
      ${EscrowPanel(task, viewerDid)}
      ${VerificationPanel(task)}
      ${DataHubLinks((task as MarketTask & { datasetUrn?: string }).datasetUrn)}
      <div class="pt-2">
        <a
          href="/ui/medical-demo/${task.id}"
          class="inline-flex items-center gap-1.5 text-sm text-emerald-400 hover:text-emerald-300"
        >
          <svg class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" /></svg>
          Open Medical Demo for this task
        </a>
      </div>
      ${task.status === "posted"
      ? html`<div class="pt-4">
            <button
              class="px-4 py-2 bg-emerald-700 hover:bg-emerald-600 text-white rounded-lg text-sm font-medium"
              hx-post="/market/tasks/${task.id}/claim"
              hx-swap="outerHTML"
            >
              Claim Task
            </button>
          </div>`
      : ""}
      ${task.resultBody
      ? html`<div class="pt-4 border-t border-slate-800">
            <div class="flex items-center justify-between mb-2">
              <h3 class="text-sm font-semibold text-white">Delivery Result</h3>
              <a
                href="/ui/market/tasks/${task.id}/result"
                target="_blank"
                rel="noopener"
                class="inline-flex items-center gap-1.5 text-xs text-emerald-400 hover:text-emerald-300"
              >
                <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                Open in new tab
              </a>
            </div>
            ${raw(renderResultBody(task.resultBody))}
          </div>`
      : ""}
      ${task.resultIpfs
      ? html`<div class="pt-2 text-xs text-slate-400">
            Full report (IPFS): <a href="${task.resultIpfs}" target="_blank" rel="noopener" class="text-blue-400 hover:underline break-all">${task.resultIpfs}</a>
          </div>`
      : ""}
      ${viewerDid
      ? html`<div class="pt-4 border-t border-slate-800">
            ${TaskMessagesFragment(task, messages, viewerDid)}
          </div>`
      : html`<div class="pt-4 border-t border-slate-800">
            <div class="rounded-lg border border-slate-800 bg-slate-900 p-4 space-y-3">
              <div class="flex items-center gap-3">
                <svg class="h-5 w-5 text-slate-500" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 3v-3z" /></svg>
                <div class="flex-1">
                  <p class="text-sm text-slate-300">Task Messages</p>
                  <p class="text-xs text-slate-500">Enter your DID to view and send messages.</p>
                </div>
              </div>
              <form
                hx-get="/ui/market/tasks/${task.id}/fragment"
                hx-target="closest div.htmx-poll-wrapper"
                hx-swap="outerHTML"
                class="flex items-center gap-2"
              >
                <input
                  type="text"
                  name="did"
                  placeholder="did:hcs:0.0.xxxx:n"
                  class="flex-1 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                />
                <button
                  type="submit"
                  class="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-medium text-white hover:bg-emerald-500 transition-colors"
                >
                  Load Messages
                </button>
              </form>
              <div class="flex items-center gap-2">
                <a
                  href="/ui/a2a/inbox?did=${encodeURIComponent(task.posterDid)}"
                  class="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-700 transition-colors"
                >
                  <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 009.586 13H7" /></svg>
                  Inbox
                </a>
                <a
                  href="/ui/a2a/outbox?did=${encodeURIComponent(task.posterDid)}"
                  class="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-700 transition-colors"
                >
                  <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" /></svg>
                  Outbox
                </a>
              </div>
            </div>
          </div>`}
    </div>
  `;
}
