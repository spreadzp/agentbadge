import { html } from "hono/html";
import type { CachedA2AMessage } from "@agentbadge/hedera-core";
import type { MarketTask } from "../../server/lib/market-task.js";
import { accountPlaceholder } from "../../server/lib/chain-ui.js";
import { shortDid, relativeTime, explorerLinks } from "./helpers";

export function TaskMessagesFragment(
  task: MarketTask,
  messages: CachedA2AMessage[],
  viewerDid: string,
) {
  const otherDid = viewerDid === task.posterDid
    ? (task.claimerDid ?? task.posterDid)
    : task.posterDid;
  const otherRole = viewerDid === task.posterDid ? "task claimer" : "task poster";
  const encodedViewer = encodeURIComponent(viewerDid);

  const inbox = messages.filter((m) => m.to === viewerDid);
  const outbox = messages.filter((m) => m.from === viewerDid);

  return html`
    <div id="task-messages" class="space-y-3">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2">
          <svg class="h-5 w-5 text-slate-400" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 3v-3z" /></svg>
          <h3 class="text-sm font-semibold text-white">Task Messages</h3>
          ${messages.length > 0
      ? html`<span class="rounded-full bg-emerald-900 text-emerald-300 text-xs px-2 py-0.5">${messages.length}</span>`
      : ""}
        </div>
        <div class="flex items-center gap-2">
          <a
            href="/ui/a2a/inbox?did=${encodedViewer}"
            class="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-700 transition-colors"
            title="View full inbox"
          >
            <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 009.586 13H7" /></svg>
            Inbox
          </a>
          <a
            href="/ui/a2a/outbox?did=${encodedViewer}"
            class="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-700 transition-colors"
            title="View full outbox"
          >
            <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" /></svg>
            Outbox
          </a>
        </div>
      </div>

      <div class="rounded-lg border border-slate-800 bg-slate-900 p-3">
        <div class="flex items-center gap-2 text-xs text-slate-500 mb-2">
          <span class="font-mono text-emerald-400" title="${viewerDid}">${shortDid(viewerDid)}</span>
          <svg class="h-3 w-3 text-slate-600" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" /></svg>
          <span class="font-mono text-sky-400" title="${otherDid}">${shortDid(otherDid)}</span>
          <span class="text-slate-600">(${otherRole})</span>
        </div>

        ${messages.length === 0
      ? html`<p class="text-sm text-slate-400 py-2">No messages yet. Ask a question below.</p>`
      : html`<div class="space-y-3 max-h-64 overflow-y-auto">
              ${inbox.length > 0
          ? html`<div>
                    <div class="text-xs font-semibold text-slate-400 mb-1">Inbox (${inbox.length})</div>
                    ${inbox.map((msg) => html`<div class="flex justify-start mb-1.5">
                      <div class="max-w-[80%] rounded-lg px-3 py-2 text-sm bg-slate-800 text-slate-200">
                        <p>${msg.body}</p>
                        <div class="flex items-center gap-1.5 mt-0.5">
                          <span class="text-xs text-slate-500">${relativeTime(msg.timestamp)}</span>
                          ${explorerLinks(msg.txId, "slate")}
                        </div>
                      </div>
                    </div>`)}
                  </div>`
          : ""}
              ${outbox.length > 0
          ? html`<div>
                    <div class="text-xs font-semibold text-slate-400 mb-1">Outbox (${outbox.length})</div>
                    ${outbox.map((msg) => html`<div class="flex justify-end mb-1.5">
                      <div class="max-w-[80%] rounded-lg px-3 py-2 text-sm bg-emerald-900 text-emerald-50">
                        <p>${msg.body}</p>
                        <div class="flex items-center gap-1.5 mt-0.5">
                          <span class="text-xs text-emerald-400">${relativeTime(msg.timestamp)}</span>
                          ${explorerLinks(msg.txId, "emerald")}
                        </div>
                      </div>
                    </div>`)}
                  </div>`
          : ""}
            </div>`}
      </div>

      <form
        hx-post="/ui/market/tasks/${task.id}/send-message"
        hx-target="#task-messages"
        hx-swap="outerHTML"
        class="space-y-2"
      >
        <input type="hidden" name="from" value="${viewerDid}" />
        <input type="hidden" name="to" value="${otherDid}" />
        <div class="grid grid-cols-2 gap-2">
          <input
            type="text"
            name="fromAccountId"
            placeholder="${accountPlaceholder()}"
            required
            class="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          />
          <input
            type="password"
            name="privateKey"
            placeholder="Private key (hex)"
            required
            class="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          />
        </div>
        <div class="flex gap-2">
          <input
            type="text"
            name="body"
            placeholder="Type a message to the task poster…"
            maxlength="4000"
            required
            class="flex-1 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          />
          <button
            type="submit"
            class="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 transition-colors"
          >
            Send
          </button>
        </div>
      </form>
    </div>
  `;
}
