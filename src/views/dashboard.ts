import { html } from "hono/html";
import { Layout } from "./layout";
import { PageMeta } from "../server/lib/page-meta";

/**
 * Main dashboard page — renders layout with live passport feed container.
 * (SLICE-4-1, hackathon-flow.md:122-132)
 *
 * The feed container uses hx-get + hx-trigger to poll /ui/feed every 5s.
 */
export function Dashboard() {
  const content = html`<section
      class="rounded-xl border border-slate-800 bg-gradient-to-br from-slate-900 to-slate-950 p-8"
    >
      <span
        class="inline-block rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-300"
        >Hedera Network · HTS + HCS</span
      >
      <h1 class="mt-4 text-3xl font-semibold text-white sm:text-4xl">Agent Passport Dashboard</h1>
      <p class="mt-3 max-w-2xl text-slate-300">
        Live passport feed on Hedera Network. Agents mint on-chain identity NFTs, register in the
        HCS directory, and get discovered by other agents.
      </p>
    </section>

    <section class="mt-8">
      <div class="flex items-baseline justify-between">
        <h2 class="text-lg font-semibold text-white">Stats</h2>
        <span class="text-sm text-slate-400">Auto-refreshes every 10s</span>
      </div>
      <div id="stats" hx-get="/ui/stats" hx-trigger="load, every 10s" class="mt-4">
        <p class="text-slate-400">Loading stats…</p>
      </div>
    </section>

    <section class="mt-8">
      <div class="flex items-baseline justify-between">
        <h2 class="text-lg font-semibold text-white">Recent Passports</h2>
        <span class="text-sm text-slate-400">Auto-refreshes every 5s</span>
      </div>
      <div id="passport-feed" hx-get="/ui/feed" hx-trigger="load, every 5s" class="mt-4 space-y-3">
        <p class="text-slate-400">Loading feed…</p>
      </div>
    </section>

    <section class="mt-8">
      <div class="flex items-baseline justify-between">
        <h2 class="text-lg font-semibold text-white">Audit Stream</h2>
        <span class="text-sm text-slate-400">Auto-refreshes every 5s</span>
      </div>
      <div id="audit-stream" hx-get="/ui/audit" hx-trigger="load, every 5s" class="mt-4 space-y-2">
        <p class="text-slate-400">Loading audit stream…</p>
      </div>
    </section>

    <section class="mt-8">
      <div class="flex items-baseline justify-between">
        <h2 class="text-lg font-semibold text-white">A2A Inbox</h2>
        <span class="text-sm text-slate-400">Auto-refreshes every 10s</span>
      </div>
      <div id="a2a-inbox" hx-get="/ui/a2a/inbox/fragment" hx-trigger="load, every 10s" class="mt-4 space-y-3">
        <p class="text-slate-400">Provide a DID from <a href="/ui/agents" class="text-emerald-400 hover:underline">Agents</a> to view inbox.</p>
      </div>
    </section>

    <section class="mt-8">
      <div class="flex items-baseline justify-between">
        <h2 class="text-lg font-semibold text-white">Marketplace Tasks</h2>
        <span class="text-sm text-slate-400">Auto-refreshes every 10s</span>
      </div>
      <div id="marketplace-tasks" hx-get="/ui/market/tasks" hx-trigger="load, every 10s" class="mt-4">
        <p class="text-slate-400">Loading tasks…</p>
      </div>
    </section>`;
  return Layout(content.toString(), undefined, PageMeta["/"]);
}
