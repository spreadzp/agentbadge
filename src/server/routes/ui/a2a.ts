// EPIC-140 (SLICE-140-15): A2A inbox/outbox + conversation — extracted from routes/ui.ts.
import { Hono } from "hono";
import { html, raw } from "hono/html";
import { A2AInboxFragment } from "../../../views/a2a-fragment";
import { Layout } from "../../../views/layout";
import { PageTitles } from "../../lib/page-titles";
import { PageMeta as PageMetaRegistry } from "../../lib/page-meta";
import { getMessagesByTo as getA2AMessagesByTo, getMessagesByFrom as getA2AMessagesByFrom, getConversation as getA2AConversation } from "@agentbadge/passport";
import { wrapFragment } from "./helpers";

export const a2aRoutes = new Hono();

a2aRoutes.get("/ui/a2a", (c) => {
  const did = c.req.query("did") ?? "";
  const page = html`
    <section class="rounded-xl border border-slate-800 bg-gradient-to-br from-slate-900 to-slate-950 p-8">
      <span class="inline-block rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-300">A2A Messaging</span>
      <h1 class="mt-4 text-3xl font-semibold text-white sm:text-4xl">A2A Inbox</h1>
      <p class="mt-3 max-w-2xl text-slate-300">
        View incoming agent-to-agent messages from the HCS directory. Enter your DID to load your inbox.
      </p>
    </section>

    <section class="mt-8">
      <form method="GET" action="/ui/a2a" class="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div class="flex-1">
          <label for="did-input" class="block text-sm font-medium text-slate-300">Your DID</label>
          <input
            id="did-input"
            type="text"
            name="did"
            value="${did}"
            placeholder="did:hcs:0.0.123:1"
            class="mt-1 block w-full rounded-lg border border-slate-700 bg-slate-900 px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          />
        </div>
        <button
          type="submit"
          class="rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-emerald-500 transition-colors"
        >
          Load Inbox
        </button>
      </form>
    </section>

    ${did
      ? html`<section class="mt-8">
          <div class="flex items-baseline justify-between">
            <h2 class="text-lg font-semibold text-white">Messages</h2>
            <span class="text-sm text-slate-400">Auto-refreshes every 10s</span>
          </div>
          <div
            id="a2a-inbox"
            hx-get="/ui/a2a/inbox/fragment?did=${encodeURIComponent(did)}"
            hx-trigger="load, every 10s"
            hx-swap="innerHTML"
            class="mt-4 space-y-3"
          >
            <p class="text-slate-400">Loading inbox…</p>
          </div>
        </section>`
      : ""}
  `;
  return c.html(Layout(page.toString(), PageTitles["/ui/a2a"], PageMetaRegistry["/ui/a2a"], undefined, true).toString());
});

a2aRoutes.get("/ui/a2a/inbox", (c) => {
  const did = c.req.query("did") ?? "";
  if (!did) {
    const page = html`
      <section class="rounded-xl border border-slate-800 bg-slate-900 p-8 text-center">
        <h1 class="text-2xl font-semibold text-white">A2A Inbox</h1>
        <p class="mt-3 text-slate-400">No DID provided. Go to <a href="/ui/agents" class="text-emerald-400 hover:underline">Agents</a> to select an agent.</p>
      </section>
    `;
    return c.html(Layout(page.toString(), PageTitles["/ui/a2a"], undefined, undefined, true).toString());
  }

  const messages = getA2AMessagesByTo(did);
  const fragment = A2AInboxFragment({ messages, userDid: did });
  const page = html`
    <section class="rounded-xl border border-slate-800 bg-gradient-to-br from-slate-900 to-slate-950 p-6">
      <div class="flex items-center justify-between">
        <div>
          <span class="inline-block rounded-full border border-sky-500/40 bg-sky-500/10 px-3 py-1 text-xs font-medium text-sky-300">Inbox</span>
          <h1 class="mt-3 text-2xl font-semibold text-white">Incoming Messages</h1>
          <p class="mt-1 text-sm text-slate-400 font-mono">${did}</p>
        </div>
        <a href="/ui/a2a/outbox?did=${encodeURIComponent(did)}" class="rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-sm text-slate-300 hover:bg-slate-700 transition-colors">
          View Outbox →
        </a>
      </div>
    </section>
    <section class="mt-6">
      <div class="flex items-baseline justify-between mb-3">
        <h2 class="text-lg font-semibold text-white">Messages</h2>
        <span class="text-sm text-slate-400">Auto-refreshes every 10s</span>
      </div>
      <div
        id="a2a-inbox"
        hx-get="/ui/a2a/inbox/fragment?did=${encodeURIComponent(did)}"
        hx-trigger="load, every 10s"
        hx-swap="innerHTML"
        class="space-y-3"
      >
        ${raw(fragment.toString())}
      </div>
    </section>
  `;
  return c.html(Layout(page.toString(), PageTitles["/ui/a2a"], undefined, undefined, true).toString());
});

a2aRoutes.get("/ui/a2a/inbox/fragment", (c) => {
  const did = c.req.query("did") ?? "";
  if (!did) return c.html("");
  const messages = getA2AMessagesByTo(did);
  const fragment = A2AInboxFragment({ messages, userDid: did });
  return c.html(fragment.toString());
});

a2aRoutes.get("/ui/a2a/outbox", (c) => {
  const did = c.req.query("did") ?? "";
  if (!did) {
    const page = html`
      <section class="rounded-xl border border-slate-800 bg-slate-900 p-8 text-center">
        <h1 class="text-2xl font-semibold text-white">A2A Outbox</h1>
        <p class="mt-3 text-slate-400">No DID provided. Go to <a href="/ui/agents" class="text-emerald-400 hover:underline">Agents</a> to select an agent.</p>
      </section>
    `;
    return c.html(Layout(page.toString(), "A2A Outbox", undefined, undefined, true).toString());
  }

  const messages = getA2AMessagesByFrom(did);
  const fragment = A2AInboxFragment({ messages, userDid: did });
  const page = html`
    <section class="rounded-xl border border-slate-800 bg-gradient-to-br from-slate-900 to-slate-950 p-6">
      <div class="flex items-center justify-between">
        <div>
          <span class="inline-block rounded-full border border-amber-500/40 bg-amber-500/10 px-3 py-1 text-xs font-medium text-amber-300">Outbox</span>
          <h1 class="mt-3 text-2xl font-semibold text-white">Sent Messages</h1>
          <p class="mt-1 text-sm text-slate-400 font-mono">${did}</p>
        </div>
        <a href="/ui/a2a/inbox?did=${encodeURIComponent(did)}" class="rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-sm text-slate-300 hover:bg-slate-700 transition-colors">
          ← View Inbox
        </a>
      </div>
    </section>
    <section class="mt-6">
      <div class="flex items-baseline justify-between mb-3">
        <h2 class="text-lg font-semibold text-white">Messages</h2>
        <span class="text-sm text-slate-400">Auto-refreshes every 10s</span>
      </div>
      <div
        id="a2a-outbox"
        hx-get="/ui/a2a/outbox/fragment?did=${encodeURIComponent(did)}"
        hx-trigger="load, every 10s"
        hx-swap="innerHTML"
        class="space-y-3"
      >
        ${raw(fragment.toString())}
      </div>
    </section>
  `;
  return c.html(Layout(page.toString(), "A2A Outbox", undefined, undefined, true).toString());
});

a2aRoutes.get("/ui/a2a/outbox/fragment", (c) => {
  const did = c.req.query("did") ?? "";
  if (!did) return c.html("");
  const messages = getA2AMessagesByFrom(did);
  const fragment = A2AInboxFragment({ messages, userDid: did });
  return c.html(fragment.toString());
});

a2aRoutes.get("/ui/conversation", (c) => {
  const didA = c.req.query("didA") ?? "";
  const didB = c.req.query("didB") ?? "";
  if (!didA || !didB) {
    return c.html(wrapFragment(c, '<div class="max-w-2xl mx-auto p-6 text-center text-slate-400"><p>Missing didA or didB parameter.</p></div>', "Conversation"));
  }
  const messages = getA2AConversation(didA, didB);
  const encA = encodeURIComponent(didA);
  const encB = encodeURIComponent(didB);
  const page = html`
    <div class="max-w-2xl mx-auto space-y-4">
      <div class="flex items-center justify-between">
        <div>
          <h1 class="text-2xl font-semibold text-white">Conversation</h1>
          <div class="mt-1 flex items-center gap-2 text-sm">
            <span class="font-mono text-emerald-400" title="${didA}">${didA.length > 16 ? `…${didA.slice(-8)}` : didA}</span>
            <svg class="h-3 w-3 text-slate-500" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" /></svg>
            <span class="font-mono text-sky-400" title="${didB}">${didB.length > 16 ? `…${didB.slice(-8)}` : didB}</span>
          </div>
        </div>
        <a href="/ui/a2a/inbox?did=${encA}" class="rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-sm text-slate-300 hover:bg-slate-700 transition-colors">
          ← Back to Inbox
        </a>
      </div>
      <div
        id="conversation-messages"
        hx-get="/ui/conversation/fragment?didA=${encA}&didB=${encB}"
        hx-trigger="load, every 10s"
        hx-swap="innerHTML"
        class="space-y-3"
      >
        ${messages.length === 0
      ? html`<div class="rounded-lg border border-slate-800 bg-slate-900 p-6 text-center text-slate-400"><p>No messages in this conversation yet.</p></div>`
      : html`<div class="space-y-3">
              ${messages.map((msg) => html`<div class="flex ${msg.from === didA ? "justify-end" : "justify-start"} mb-1.5">
                <div class="max-w-[80%] rounded-lg px-3 py-2 text-sm ${msg.from === didA ? "bg-emerald-900 text-emerald-50" : "bg-slate-800 text-slate-200"}">
                  <p>${msg.body}</p>
                  <div class="flex items-center gap-1.5 mt-0.5">
                    <span class="text-xs ${msg.from === didA ? "text-emerald-400" : "text-slate-500"}">${msg.timestamp ? new Date(msg.timestamp * 1000).toLocaleString() : ""}</span>
                  </div>
                </div>
              </div>`)}
            </div>`}
      </div>
    </div>
  `;
  return c.html(wrapFragment(c, page.toString(), "Conversation"));
});

a2aRoutes.get("/ui/conversation/fragment", (c) => {
  const didA = c.req.query("didA") ?? "";
  const didB = c.req.query("didB") ?? "";
  if (!didA || !didB) return c.html("");
  const messages = getA2AConversation(didA, didB);
  if (messages.length === 0) {
    return c.html('<div class="rounded-lg border border-slate-800 bg-slate-900 p-6 text-center text-slate-400"><p>No messages in this conversation yet.</p></div>');
  }
  return c.html(html`<div class="space-y-3">
    ${messages.map((msg) => html`<div class="flex ${msg.from === didA ? "justify-end" : "justify-start"} mb-1.5">
      <div class="max-w-[80%] rounded-lg px-3 py-2 text-sm ${msg.from === didA ? "bg-emerald-900 text-emerald-50" : "bg-slate-800 text-slate-200"}">
        <p>${msg.body}</p>
        <div class="flex items-center gap-1.5 mt-0.5">
          <span class="text-xs ${msg.from === didA ? "text-emerald-400" : "text-slate-500"}">${msg.timestamp ? new Date(msg.timestamp * 1000).toLocaleString() : ""}</span>
        </div>
      </div>
    </div>`)}
  </div>`.toString());
});
