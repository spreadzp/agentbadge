import { html } from "hono/html";
import type { CachedA2AMessage } from "@agentbadge/hedera-core";

const PAGE_SIZE = 4;

function shortDid(did: string): string {
  return did.length > 16 ? `…${did.slice(-8)}` : did;
}

function relativeTime(timestamp: number): string {
  const now = Math.floor(Date.now() / 1000);
  const diff = now - timestamp;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)} minute${Math.floor(diff / 60) !== 1 ? "s" : ""} ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} hour${Math.floor(diff / 3600) !== 1 ? "s" : ""} ago`;
  return `${Math.floor(diff / 86400)} day${Math.floor(diff / 86400) !== 1 ? "s" : ""} ago`;
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function MessageRow({ msg, userDid }: { msg: CachedA2AMessage; userDid: string }) {
  const otherDid = msg.from === userDid ? msg.to : msg.from;
  const encodedUser = encodeURIComponent(userDid);
  const encodedOther = encodeURIComponent(otherDid);
  const viewUrl = `/ui/conversation?didA=${encodedUser}&didB=${encodedOther}`;

  return html`<div
    class="rounded-lg border border-slate-800 bg-slate-900 p-4 hover:border-slate-600 transition-colors"
  >
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-2">
        <span class="text-sm font-mono text-emerald-400" title="${msg.from}">${shortDid(msg.from)}</span>
        <svg class="h-3 w-3 text-slate-500" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M14 5l7 7m0 0l-7 7m7-7H3" /></svg>
        <span class="text-sm font-mono text-sky-400" title="${msg.to}">${shortDid(msg.to)}</span>
      </div>
      <span class="text-xs text-slate-500">${relativeTime(msg.timestamp)}</span>
    </div>
    <div class="mt-2 flex items-center justify-between">
      <p class="text-sm text-slate-300 truncate">${truncate(msg.body, 50)}</p>
      <a
        href="${viewUrl}"
        class="ml-3 shrink-0 rounded border border-slate-700 bg-slate-800 px-3 py-1 text-xs text-slate-300 hover:bg-slate-700 transition-colors"
      >
        View
      </a>
    </div>
  </div>`;
}

export function A2AInboxFragment({ messages, userDid }: { messages: CachedA2AMessage[]; userDid: string }) {
  if (messages.length === 0) {
    return html`<div
      class="rounded-lg border border-slate-800 bg-slate-900 p-6 text-center text-slate-300"
    >
      <p>No messages.</p>
      <p class="text-sm mt-2 text-slate-400">Incoming A2A messages will appear here automatically.</p>
    </div>`;
  }

  const visible = messages.slice(0, PAGE_SIZE);
  const hidden = messages.slice(PAGE_SIZE);

  return html`<div class="space-y-3"
    >${visible.map((msg) => MessageRow({ msg, userDid }))}${hidden.map(
    (msg) =>
      html`<div class="hidden" data-paginated="true">${MessageRow({ msg, userDid })}</div>`,
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
