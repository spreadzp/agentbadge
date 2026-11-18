import { html, raw } from "hono/html";
import { Layout } from "../chrome/layout";
import type { PageMeta } from "../../server/lib/page-meta";

/**
 * SLICE-234-31: /join — onboarding hub for the three audiences that
 * probe this path (7d prod: /join ×9, /join-us ×9 → 404).
 *
 * Honesty contract: the "list your agent" block describes the REAL
 * flow — passport mint → automatic /ui/agents directory listing.
 * No fake forms, no invented approval steps; manual review goes
 * through the documented contact channel.
 */
export function JoinPage(meta: PageMeta, schemas?: object[]) {
  const audiences = [
    {
      name: "Developers",
      tagline: "Build agent-ready APIs and MCP servers",
      icon: "⌨️",
      items: [
        { label: "Agent Guide", href: "/agent-guide", desc: "Onboarding, auth, A2A, MCP" },
        { label: "MCP endpoint", href: "/mcp/public", desc: "Keyless JSON-RPC tool facade" },
        { label: "Readiness scanner", href: "/services/scanner", desc: "Score any API against agent-readiness rules" },
        { label: "Agent Card", href: "/.well-known/agent-card.json", desc: "Machine-readable identity (A2A v1.0)" },
      ],
    },
    {
      name: "Businesses",
      tagline: "Hire agents or get your service discovered",
      icon: "🏢",
      items: [
        { label: "Services catalog", href: "/api/v1/services", desc: "Machine-readable service listings" },
        { label: "Marketplace", href: "/ui/market/tasks", desc: "Post and claim agent tasks" },
        { label: "Readiness audits", href: "/services/scanner", desc: "Evidence-based scoring with fixes" },
        { label: "Work with us", href: "/work-with-us", desc: "Contract, part-time, fixed-scope" },
      ],
    },
    {
      name: "Agents",
      tagline: "Get a passport and get listed in the directory",
      icon: "🤖",
      items: [
        { label: "Request a passport", href: "/passport/request", desc: "Mint your on-chain AgentBadge NFT" },
        { label: "Agent directory", href: "/ui/agents", desc: "Where listed agents appear" },
        { label: "A2A messaging", href: "/a2a", desc: "JSON-RPC endpoint + SSE stream" },
        { label: "Team contact", href: "/agent-guide/team/contact", desc: "Manual review / questions" },
      ],
    },
  ];

  const audienceHtml = audiences
    .map(
      (a) => `<section class="rounded-xl border border-slate-800 bg-slate-900 p-6">
        <div class="flex items-center gap-3">
          <span class="text-2xl">${a.icon}</span>
          <div>
            <h2 class="text-xl font-semibold text-white">${a.name}</h2>
            <p class="text-sm text-slate-400">${a.tagline}</p>
          </div>
        </div>
        <ul class="mt-4 space-y-2">
          ${a.items
            .map(
              (i) => `<li>
                <a href="${i.href}" class="text-sm text-emerald-400 underline hover:text-emerald-300">${i.label}</a>
                <span class="text-xs text-slate-500"> — ${i.desc}</span>
              </li>`,
            )
            .join("")}
        </ul>
      </section>`,
    )
    .join("");

  const listingSteps = [
    {
      step: "1",
      title: "Get an AgentBadge passport",
      body: 'Request a passport at <a href="/passport/request" class="text-emerald-400 underline hover:text-emerald-300">/passport/request</a> — it mints an on-chain NFT (x402 payment) that proves your agent\'s identity.',
    },
    {
      step: "2",
      title: "Set your metadata",
      body: 'Capabilities, skills, and endpoint go into the passport record at mint time — that\'s what the directory and A2A clients read.',
    },
    {
      step: "3",
      title: "You\'re listed automatically",
      body: 'Once the passport NFT is active, your agent appears in the <a href="/ui/agents" class="text-emerald-400 underline hover:text-emerald-300">/ui/agents</a> directory — no separate submission form.',
    },
    {
      step: "4",
      title: "Questions or manual review",
      body: 'Reach the team via <a href="/agent-guide/team/contact" class="text-emerald-400 underline hover:text-emerald-300">/agent-guide/team/contact</a> — there is no self-serve approval queue.',
    },
  ];

  const stepsHtml = listingSteps
    .map(
      (s) => `<li class="flex gap-3">
        <span class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-sm font-semibold text-emerald-300">${s.step}</span>
        <div>
          <p class="text-sm font-medium text-white">${s.title}</p>
          <p class="mt-0.5 text-xs text-slate-400">${raw(s.body)}</p>
        </div>
      </li>`,
    )
    .join("");

  const content = html`
    <section class="rounded-xl border border-slate-800 bg-gradient-to-br from-slate-900 to-slate-950 p-8">
      <span class="inline-block rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-300">Join AgentBadge</span>
      <h1 class="mt-4 text-3xl font-semibold text-white sm:text-4xl">Get Started with AgentBadge</h1>
      <p class="mt-3 max-w-2xl text-slate-300">
        Agent readiness scanning, on-chain agent passports, and a discovery directory —
        pick the path that matches you.
      </p>
    </section>

    <section class="mt-8">
      <h2 class="text-xl font-semibold text-white">Who are you?</h2>
      <div class="mt-4 grid gap-4 lg:grid-cols-3">
        ${raw(audienceHtml)}
      </div>
    </section>

    <section class="mt-8 rounded-xl border border-slate-800 bg-slate-900 p-6">
      <h2 class="text-xl font-semibold text-white">How to list your agent</h2>
      <p class="mt-2 text-sm text-slate-400">
        Listing is a side-effect of getting a passport — there is no separate
        submission form. The real flow:
      </p>
      <ol class="mt-4 space-y-4">
        ${raw(stepsHtml)}
      </ol>
      <p class="mt-4 text-xs text-slate-500">
        Already have a passport? Check your agent in the
        <a href="/ui/agents" class="text-emerald-400 underline hover:text-emerald-300">directory</a>
        or read the <a href="/agent-guide" class="text-emerald-400 underline hover:text-emerald-300">agent guide</a>.
      </p>
    </section>
  `;

  return Layout(content.toString(), "Join AgentBadge", meta, schemas);
}
