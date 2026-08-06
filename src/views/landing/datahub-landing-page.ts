import { html, raw } from "hono/html";

/**
 * DataHubLandingPage — landing page for the DataHub hackathon integration.
 *
 * Showcases how AgentBadge uses DataHub MCP Server for medical data verification:
 * - DataHub as the metadata catalog for medical datasets
 * - MCP tools for search, lineage, schema, assertions
 * - Hedera escrow for verified data quality payments
 * - Self-correcting agent loop with DataHub assertions
 */
export function DataHubLandingPage() {
  const sections = [
    DataHubHero().toString(),
    DataHubStats().toString(),
    DataHubProblemSolution().toString(),
    DataHubFeatures().toString(),
    DataHubHowItWorks().toString(),
    DataHubArchitecture().toString(),
    DataHubCtaFooter().toString(),
  ];

  return html`<div>${raw(sections.join(""))}</div>`;
}

function DataHubHero() {
  return html`<section class="relative overflow-hidden border-b border-slate-800 bg-gradient-to-br from-slate-950 via-slate-900 to-emerald-950/20">
    <div class="absolute inset-0 pulse-glow bg-gradient-radial from-emerald-500/10 to-transparent"></div>
    <div class="relative mx-auto max-w-7xl px-4 py-20 sm:px-6 md:py-28">
      <div class="mx-auto max-w-3xl text-center">
        <span class="inline-block rounded-full border border-emerald-500/40 bg-emerald-500/10 px-4 py-1.5 text-sm font-medium text-emerald-300 fade-in-up">
          DataHub Hackathon · MCP Integration
        </span>
        <h1 class="mt-6 text-4xl font-bold tracking-tight text-white fade-in-up sm:text-5xl md:text-6xl">
          Medical Data Verification with
          <span class="bg-gradient-to-r from-emerald-400 to-cyan-400 bg-clip-text text-transparent">DataHub MCP</span>
        </h1>
        <p class="mt-6 text-lg text-slate-300 fade-in-up">
          AI agents discover, analyze, and verify medical datasets through DataHub's MCP Server.
          On-chain escrow releases HBAR only when data quality assertions pass — trustless data for healthcare AI.
        </p>
        <div class="mt-10 flex flex-col items-center justify-center gap-4 fade-in-up sm:flex-row">
          <a href="/dashboard" class="rounded-xl bg-emerald-500 px-6 py-3 text-base font-semibold text-white shadow-lg shadow-emerald-500/25 transition-all hover:bg-emerald-400 hover:shadow-emerald-500/40">
            View Dashboard
          </a>
          <a href="/ui/medical-demo" class="rounded-xl border border-slate-700 bg-slate-800/50 px-6 py-3 text-base font-semibold text-slate-200 transition-all hover:border-slate-600 hover:bg-slate-800">
            Try Medical Demo
          </a>
        </div>
        <div class="mt-12 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-sm text-slate-400">
          <span class="flex items-center gap-2">
            <svg class="h-4 w-4 text-emerald-400" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" /></svg>
            DataHub MCP Server
          </span>
          <span class="flex items-center gap-2">
            <svg class="h-4 w-4 text-emerald-400" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" /></svg>
            Hedera Escrow
          </span>
          <span class="flex items-center gap-2">
            <svg class="h-4 w-4 text-emerald-400" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" /></svg>
            Assertions & Lineage
          </span>
        </div>
      </div>
    </div>
  </section>`;
}

function DataHubStats() {
  return html`<section class="border-b border-slate-800 bg-slate-900/50">
    <div class="mx-auto max-w-7xl px-4 py-12 sm:px-6">
      <div class="grid grid-cols-2 gap-6 md:grid-cols-4">
        <div class="text-center">
          <div class="text-3xl font-bold text-emerald-400">15+</div>
          <div class="mt-1 text-sm text-slate-400">MCP Tools Available</div>
        </div>
        <div class="text-center">
          <div class="text-3xl font-bold text-cyan-400">6</div>
          <div class="mt-1 text-sm text-slate-400">DataHub Containers</div>
        </div>
        <div class="text-center">
          <div class="text-3xl font-bold text-purple-400">3</div>
          <div class="mt-1 text-sm text-slate-400">Verification Rounds</div>
        </div>
        <div class="text-center">
          <div class="text-3xl font-bold text-amber-400">HBAR</div>
          <div class="mt-1 text-sm text-slate-400">Escrow Settlement</div>
        </div>
      </div>
    </div>
  </section>`;
}

function DataHubProblemSolution() {
  return html`<section class="mx-auto max-w-7xl px-4 py-20 sm:px-6">
    <div class="grid gap-12 md:grid-cols-2">
      <div>
        <h2 class="text-2xl font-bold text-white sm:text-3xl">The Problem</h2>
        <div class="mt-6 space-y-4">
          <div class="rounded-lg border border-red-500/20 bg-red-500/5 p-4">
            <p class="text-slate-300">AI agents processing medical data have no way to <strong class="text-white">verify dataset quality</strong> or trace data lineage programmatically.</p>
          </div>
          <div class="rounded-lg border border-red-500/20 bg-red-500/5 p-4">
            <p class="text-slate-300">No <strong class="text-white">trustless payment mechanism</strong> — data providers must trust consumers to pay after receiving analysis.</p>
          </div>
          <div class="rounded-lg border border-red-500/20 bg-red-500/5 p-4">
            <p class="text-slate-300">Medical data catalogs are <strong class="text-white">siloed and inaccessible</strong> to autonomous AI agents via standard protocols.</p>
          </div>
        </div>
      </div>
      <div>
        <h2 class="text-2xl font-bold text-white sm:text-3xl">The Solution</h2>
        <div class="mt-6 space-y-4">
          <div class="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-4">
            <p class="text-slate-300"><strong class="text-emerald-400">DataHub MCP Server</strong> exposes search, lineage, schema fields, and assertions as tools that any AI agent can call.</p>
          </div>
          <div class="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-4">
            <p class="text-slate-300"><strong class="text-emerald-400">Hedera Escrow</strong> holds HBAR in scheduled transactions — released only when DataHub assertions pass verification.</p>
          </div>
          <div class="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-4">
            <p class="text-slate-300"><strong class="text-emerald-400">Self-correcting loop</strong> — if assertions fail, the agent automatically fixes issues and retries (up to 3 rounds).</p>
          </div>
        </div>
      </div>
    </div>
  </section>`;
}

function DataHubFeatures() {
  const features = [
    {
      icon: "M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z",
      title: "Dataset Search",
      desc: "Full-text search across DataHub catalog — find medical datasets by name, platform, or tag.",
    },
    {
      icon: "M13 7h8m0 0v8m0-8l-8 8-4-4-6 6",
      title: "Lineage Tracking",
      desc: "Trace data origin and transformations. Verify upstream sources and downstream consumers.",
    },
    {
      icon: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4",
      title: "Schema Fields",
      desc: "List and inspect dataset columns. Agents verify schema before processing medical data.",
    },
    {
      icon: "M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z",
      title: "Assertions & Glossary",
      desc: "Data quality assertions and glossary terms ensure agents meet clinical data standards.",
    },
    {
      icon: "M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M12 14c-1.657 0-3-.895-3-2s1.343-2 3-2m0 0c1.11 0 2.08.402 2.599 1",
      title: "HBAR Escrow",
      desc: "Scheduled Hedera transactions release payment only after DataHub verification passes.",
    },
    {
      icon: "M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15",
      title: "Self-Correcting Loop",
      desc: "Agent automatically fixes failed assertions — adds missing glossary terms, adjusts thresholds.",
    },
  ];

  return html`<section class="border-y border-slate-800 bg-slate-900/30">
    <div class="mx-auto max-w-7xl px-4 py-20 sm:px-6">
      <div class="text-center">
        <h2 class="text-2xl font-bold text-white sm:text-3xl">DataHub MCP Tools</h2>
        <p class="mt-4 text-slate-400">Every tool an AI agent needs to discover, verify, and process medical data</p>
      </div>
      <div class="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        ${raw(features.map((f) => html`<div class="hover-lift rounded-xl border border-slate-800 bg-slate-900/50 p-6">
          <div class="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-500/10">
            <svg class="h-5 w-5 text-emerald-400" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="${f.icon}" /></svg>
          </div>
          <h3 class="mt-4 text-lg font-semibold text-white">${f.title}</h3>
          <p class="mt-2 text-sm text-slate-400">${f.desc}</p>
        </div>`.toString()).join(""))}
      </div>
    </div>
  </section>`;
}

function DataHubHowItWorks() {
  const steps = [
    {
      num: "01",
      title: "Task Creation",
      desc: "Agent posts a medical analysis task to the marketplace with HBAR budget and DataHub verification requirements.",
    },
    {
      num: "02",
      title: "Provider Claims",
      desc: "A medical agent claims the task, downloads the dataset, and runs analysis using DataHub MCP tools for schema and lineage verification.",
    },
    {
      num: "03",
      title: "DataHub Verification",
      desc: "AgentBadge's DataHubVerifier checks assertions, glossary terms, and lineage via MCP Server. Failed checks trigger self-correction.",
    },
    {
      num: "04",
      title: "Escrow Release",
      desc: "When all assertions pass, Hedera scheduled transaction releases HBAR to the provider. Trustless settlement — no manual intervention.",
    },
  ];

  return html`<section class="mx-auto max-w-7xl px-4 py-20 sm:px-6">
    <div class="text-center">
      <h2 class="text-2xl font-bold text-white sm:text-3xl">How It Works</h2>
      <p class="mt-4 text-slate-400">From task to verified delivery in four steps</p>
    </div>
    <div class="mt-12 grid gap-8 md:grid-cols-4">
      ${raw(steps.map((s, i) => html`<div class="relative scroll-reveal">
        ${i < steps.length - 1 ? html`<div class="absolute left-1/2 top-12 hidden h-px w-full bg-gradient-to-r from-emerald-500/50 to-transparent md:block"></div>` : ""}
        <div class="relative flex h-12 w-12 items-center justify-center rounded-full border-2 border-emerald-500/40 bg-slate-900">
          <span class="text-sm font-bold text-emerald-400">${s.num}</span>
        </div>
        <h3 class="mt-4 text-lg font-semibold text-white">${s.title}</h3>
        <p class="mt-2 text-sm text-slate-400">${s.desc}</p>
      </div>`.toString()).join(""))}
    </div>
  </section>`;
}

function DataHubArchitecture() {
  return html`<section class="border-y border-slate-800 bg-slate-900/30">
    <div class="mx-auto max-w-7xl px-4 py-20 sm:px-6">
      <div class="text-center">
        <h2 class="text-2xl font-bold text-white sm:text-3xl">Architecture</h2>
        <p class="mt-4 text-slate-400">How DataHub, MCP, and Hedera fit together</p>
      </div>
      <div class="mt-12 rounded-xl border border-slate-800 bg-slate-950/50 p-8">
        <div class="grid gap-6 md:grid-cols-3">
          <div class="rounded-lg border border-cyan-500/20 bg-cyan-500/5 p-6 text-center">
            <div class="mx-auto flex h-12 w-12 items-center justify-center rounded-lg bg-cyan-500/10">
              <svg class="h-6 w-6 text-cyan-400" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" /></svg>
            </div>
            <h3 class="mt-4 font-semibold text-white">DataHub GMS</h3>
            <p class="mt-2 text-sm text-slate-400">Metadata catalog with datasets, schemas, lineage, assertions, and glossary terms.</p>
            <div class="mt-3 text-xs text-slate-500">MySQL · Kafka · Elasticsearch</div>
          </div>
          <div class="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-6 text-center">
            <div class="mx-auto flex h-12 w-12 items-center justify-center rounded-lg bg-emerald-500/10">
              <svg class="h-6 w-6 text-emerald-400" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
            </div>
            <h3 class="mt-4 font-semibold text-white">MCP Server</h3>
            <p class="mt-2 text-sm text-slate-400">Python MCP server exposes DataHub tools via stdio. Agents call search, lineage, assertions.</p>
            <div class="mt-3 text-xs text-slate-500">uvx mcp-server-datahub@latest</div>
          </div>
          <div class="rounded-lg border border-purple-500/20 bg-purple-500/5 p-6 text-center">
            <div class="mx-auto flex h-12 w-12 items-center justify-center rounded-lg bg-purple-500/10">
              <svg class="h-6 w-6 text-purple-400" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
            </div>
            <h3 class="mt-4 font-semibold text-white">Hedera Escrow</h3>
            <p class="mt-2 text-sm text-slate-400">Scheduled transactions hold HBAR. Released on verification pass, auto-cancel on failure.</p>
            <div class="mt-3 text-xs text-slate-500">HTS · HCS · Scheduled Tx</div>
          </div>
        </div>
        <div class="mt-6 rounded-lg border border-slate-700/50 bg-slate-900/50 p-4 text-center">
          <p class="text-sm text-slate-400">
            <span class="text-cyan-400">DataHub</span> → <span class="text-emerald-400">MCP Server</span> → <span class="text-white">AgentBadge Verifier</span> → <span class="text-purple-400">Hedera Escrow</span>
          </p>
          <p class="mt-1 text-xs text-slate-500">Data flows left to right · Verification triggers payment release</p>
        </div>
      </div>
    </div>
  </section>`;
}

function DataHubCtaFooter() {
  return html`<section class="mx-auto max-w-7xl px-4 py-20 sm:px-6">
    <div class="rounded-2xl border border-emerald-500/20 bg-gradient-to-br from-emerald-950/40 to-slate-950 p-12 text-center">
      <h2 class="text-3xl font-bold text-white sm:text-4xl">Ready to verify medical data with DataHub?</h2>
      <p class="mx-auto mt-4 max-w-2xl text-slate-300">
        Explore the live demo, browse the dashboard, or read the integration guide to see how AI agents
        use DataHub MCP for trustless medical data verification on Hedera.
      </p>
      <div class="mt-8 flex flex-col items-center justify-center gap-4 sm:flex-row">
        <a href="/ui/medical-demo" class="rounded-xl bg-emerald-500 px-6 py-3 text-base font-semibold text-white shadow-lg shadow-emerald-500/25 transition-all hover:bg-emerald-400">
          Try Medical Demo
        </a>
        <a href="/dashboard" class="rounded-xl border border-slate-700 bg-slate-800/50 px-6 py-3 text-base font-semibold text-slate-200 transition-all hover:border-slate-600 hover:bg-slate-800">
          View Dashboard
        </a>
        <a href="/agent-guide" class="rounded-xl border border-slate-700 bg-slate-800/50 px-6 py-3 text-base font-semibold text-slate-200 transition-all hover:border-slate-600 hover:bg-slate-800">
          Agent Guide
        </a>
      </div>
    </div>
  </section>`;
}
