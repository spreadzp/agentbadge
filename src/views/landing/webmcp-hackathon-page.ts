import { html, raw } from "hono/html";
import { injectWebMCP, allTools, generateDeclarativeForm, generateDeclarativeScript, generateDeclarativeStyles } from "@agentgate-hedera/webmcp";

/**
 * WebMcpHackathonPage — landing page for the WebMCP Challenge hackathon.
 *
 * Showcases AgentBadge as an agent-native compliance platform powered by WebMCP:
 * - 6 imperative tools exposed via document.modelContext.registerTool()
 * - 1 declarative form tool
 * - Discovery endpoint at /.well-known/webmcp.json
 * - Demo instructions for Chrome flag and ChatGPT in-app browser
 */
export function WebMcpHackathonPage() {
  const sections = [
    WebMcpHero().toString(),
    WebMcpTools().toString(),
    WebMcpDeclarative().toString(),
    WebMcpDemoInstructions().toString(),
    WebMcpDiscovery().toString(),
    WebMcpCtaFooter().toString(),
  ];

  return html`<div>${raw(sections.join(""))}</div>`;
}

function WebMcpHero() {
  return html`<section class="relative overflow-hidden border-b border-slate-700/50 bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950/20">
    <div class="absolute inset-0 pulse-glow bg-gradient-radial from-indigo-500/10 to-transparent"></div>
    <div class="relative mx-auto max-w-6xl px-6 py-20 sm:px-8 lg:px-12 md:py-28">
      <div class="mx-auto max-w-3xl text-center">
        <span class="inline-block rounded-full border border-indigo-600/30 bg-indigo-500/10 px-4 py-1.5 text-sm font-medium text-indigo-300 fade-in-up">
          WebMCP Challenge · Hackathon Submission
        </span>
        <h1 class="mt-6 text-4xl font-bold tracking-tight text-white fade-in-up sm:text-5xl md:text-6xl">
          AgentBadge — First
          <span class="bg-gradient-to-r from-indigo-400 to-cyan-400 bg-clip-text text-transparent">Agent-Native Compliance</span>
          Platform Powered by WebMCP
        </h1>
        <p class="mt-6 text-lg text-slate-300 fade-in-up">
          Six imperative tools, a declarative form API, and a discovery endpoint — all exposed
          through the browser's native <code class="rounded bg-slate-800 px-1.5 py-0.5 text-sm text-indigo-300">document.modelContext</code> interface.
          AI agents discover and use AgentBadge without leaving the page.
        </p>
        <div class="mt-10 flex flex-col items-center justify-center gap-4 fade-in-up sm:flex-row">
          <a href="/dashboard" class="rounded-xl bg-indigo-500 px-6 py-3 text-base font-semibold text-white shadow-lg shadow-indigo-500/25 transition-all hover:bg-indigo-400 hover:shadow-indigo-500/40">
            View Dashboard
          </a>
          <a href="/hackathon/datahub" class="rounded-xl border border-slate-700 bg-slate-800/50 px-6 py-3 text-base font-semibold text-slate-200 transition-all hover:border-slate-600 hover:bg-slate-800">
            DataHub Integration
          </a>
        </div>
        <div class="mt-12 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-sm text-slate-400">
          <span class="flex items-center gap-2">
            <svg class="h-4 w-4 text-indigo-400" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" /></svg>
            6 Imperative Tools
          </span>
          <span class="flex items-center gap-2">
            <svg class="h-4 w-4 text-indigo-400" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" /></svg>
            1 Declarative Form
          </span>
          <span class="flex items-center gap-2">
            <svg class="h-4 w-4 text-indigo-400" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" /></svg>
            Discovery Endpoint
          </span>
        </div>
      </div>
    </div>
  </section>`;
}

function WebMcpTools() {
  const tools = [
    {
      name: "agent-readiness-scan",
      desc: "Scan a website for AI agent readiness compliance. Returns a compliance score and list of checks.",
      readOnly: true,
      untrusted: true,
      endpoint: "GET /api/scan?url=",
      icon: "M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z",
    },
    {
      name: "badge-generate",
      desc: "Generate a compliance badge SVG for a given URL and score.",
      readOnly: true,
      untrusted: false,
      endpoint: "GET /api/badge?url=",
      icon: "M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z",
    },
    {
      name: "passport-issue",
      desc: "Issue an AgentBadge passport NFT for a given account on Hedera.",
      readOnly: false,
      untrusted: false,
      endpoint: "POST /passport/issue",
      icon: "M12 4v16m8-8H4",
    },
    {
      name: "passport-verify",
      desc: "Verify an AgentBadge passport by token ID. Returns on-chain identity and metadata.",
      readOnly: true,
      untrusted: false,
      endpoint: "GET /api/passport/verify?tokenId=",
      icon: "M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z",
    },
    {
      name: "get-compliance-score",
      desc: "Get the agent readiness compliance score for a given URL.",
      readOnly: true,
      untrusted: true,
      endpoint: "GET /api/score?url=",
      icon: "M13 7h8m0 0v8m0-8l-8 8-4-4-6 6",
    },
    {
      name: "search-rules",
      desc: "Search agent readiness rules by keyword. Returns matching rule definitions.",
      readOnly: true,
      untrusted: false,
      endpoint: "GET /api/rules/search?q=",
      icon: "M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z",
    },
  ];

  return html`<section class="border-y border-slate-700/50 bg-slate-900/30">
    <div class="mx-auto max-w-6xl px-6 py-20 sm:px-8 lg:px-12">
      <div class="text-center">
        <h2 class="text-2xl font-bold text-white sm:text-3xl">Imperative Tools</h2>
        <p class="mt-4 text-slate-400">Six tools exposed via <code class="rounded bg-slate-800 px-1.5 py-0.5 text-sm text-indigo-300">document.modelContext.registerTool()</code></p>
      </div>
      <div class="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        ${raw(tools.map((t) => html`<div class="hover-lift rounded-xl border border-slate-700/40 bg-slate-900/50 p-6">
          <div class="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-500/10">
            <svg class="h-5 w-5 text-indigo-400" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="${t.icon}" /></svg>
          </div>
          <h3 class="mt-4 text-lg font-semibold text-white font-mono">${t.name}</h3>
          <p class="mt-2 text-sm text-slate-400">${t.desc}</p>
          <div class="mt-3 flex items-center gap-2 text-xs">
            <span class="rounded ${t.readOnly ? "bg-emerald-500/10 text-emerald-400" : "bg-amber-500/10 text-amber-400"} px-2 py-0.5 font-medium">${t.readOnly ? "readOnly" : "write"}</span>
            <span class="rounded ${t.untrusted ? "bg-cyan-500/10 text-cyan-400" : "bg-purple-500/10 text-purple-400"} px-2 py-0.5 font-medium">${t.untrusted ? "untrusted" : "trusted"}</span>
          </div>
          <div class="mt-3 rounded bg-slate-950/50 px-3 py-1.5 text-xs font-mono text-slate-500">${t.endpoint}</div>
        </div>`.toString()).join(""))}
      </div>
    </div>
  </section>`;
}

function WebMcpDeclarative() {
  const formHtml = generateDeclarativeForm({
    toolname: "submitScanRequest",
    tooldescription: "Submit a URL for agent readiness scanning. Returns a compliance report.",
    action: "/api/scan",
    method: "GET",
    toolautosubmit: true,
    inputs: [
      {
        name: "url",
        type: "url",
        id: "scanUrl",
        label: "URL to Scan",
        required: true,
        toolparamdescription: "The URL to scan for AI agent readiness compliance.",
      },
    ],
  });
  const scriptHtml = generateDeclarativeScript();
  const stylesHtml = generateDeclarativeStyles();

  return html`<section class="mx-auto max-w-6xl px-6 py-20 sm:px-8 lg:px-12">
    <div class="grid gap-12 md:grid-cols-2">
      <div>
        <h2 class="text-2xl font-bold text-white sm:text-3xl">Declarative API</h2>
        <p class="mt-4 text-slate-400">Form-based tool exposure for agents that prefer declarative discovery.</p>
        <div class="mt-6 rounded-xl border border-slate-700/40 bg-slate-900/50 p-6">
          <h3 class="font-mono text-lg font-semibold text-white">submitScanRequest</h3>
          <p class="mt-2 text-sm text-slate-400">Submit a scan request via HTML form. The agent fills the form and the browser submits it.</p>
          <div class="mt-4 space-y-2 text-sm">
            <div class="flex items-center gap-2 text-slate-400">
              <span class="rounded bg-slate-800 px-2 py-0.5 font-mono text-xs">action</span>
              <span class="font-mono text-indigo-300">/api/scan</span>
            </div>
            <div class="flex items-center gap-2 text-slate-400">
              <span class="rounded bg-slate-800 px-2 py-0.5 font-mono text-xs">method</span>
              <span class="font-mono text-indigo-300">GET</span>
            </div>
            <div class="flex items-center gap-2 text-slate-400">
              <span class="rounded bg-slate-800 px-2 py-0.5 font-mono text-xs">input</span>
              <span class="font-mono text-indigo-300">url (string)</span>
            </div>
          </div>
          <div class="mt-6 rounded-lg border border-slate-700/40 bg-slate-950/50 p-4">
            <h4 class="mb-3 text-sm font-semibold text-slate-300">Live Form</h4>
            ${raw(formHtml)}
          </div>
        </div>
      </div>
      <div>
        <h2 class="text-2xl font-bold text-white sm:text-3xl">Why WebMCP?</h2>
        <div class="mt-6 space-y-4">
          <div class="rounded-lg border border-slate-700/40 bg-slate-800/30 p-4">
            <p class="text-slate-300"><strong class="text-white">No API keys needed.</strong> Tools are discovered natively by the browser and exposed to AI agents through the standard <code class="rounded bg-slate-800 px-1 text-sm text-indigo-300">document.modelContext</code> interface.</p>
          </div>
          <div class="rounded-lg border border-slate-700/40 bg-slate-800/30 p-4">
            <p class="text-slate-300"><strong class="text-white">Secure by default.</strong> Trusted tools require user consent. Untrusted tools run in sandboxed contexts. The browser mediates all calls.</p>
          </div>
          <div class="rounded-lg border border-slate-700/40 bg-slate-800/30 p-4">
            <p class="text-slate-300"><strong class="text-white">Zero integration.</strong> Agents discover tools automatically via the <a href="/.well-known/webmcp.json" class="text-indigo-400 hover:text-indigo-300">discovery endpoint</a>. No manual configuration or MCP server setup required.</p>
          </div>
        </div>
      </div>
    </div>
    ${raw(stylesHtml)}
    ${raw(scriptHtml)}
  </section>`;
}

function WebMcpDemoInstructions() {
  return html`<section class="border-y border-slate-700/50 bg-slate-900/30">
    <div class="mx-auto max-w-6xl px-6 py-20 sm:px-8 lg:px-12">
      <div class="text-center">
        <h2 class="text-2xl font-bold text-white sm:text-3xl">Try It Now</h2>
        <p class="mt-4 text-slate-400">Test WebMCP tools with ChatGPT or Chrome</p>
      </div>
      <div class="mt-12 grid gap-8 md:grid-cols-2">
        <div class="rounded-xl border border-slate-700/40 bg-slate-900/50 p-8">
          <div class="flex h-12 w-12 items-center justify-center rounded-lg bg-cyan-500/10">
            <svg class="h-6 w-6 text-cyan-400" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
          </div>
          <h3 class="mt-4 text-xl font-semibold text-white">Chrome Flag</h3>
          <ol class="mt-4 space-y-3 text-sm text-slate-400">
            <li class="flex gap-3"><span class="font-bold text-cyan-400">1.</span> Open <code class="rounded bg-slate-800 px-1.5 py-0.5 text-xs text-cyan-300">chrome://flags/#enable-webmcp-testing</code> in Chrome</li>
            <li class="flex gap-3"><span class="font-bold text-cyan-400">2.</span> Enable the WebMCP testing flag</li>
            <li class="flex gap-3"><span class="font-bold text-cyan-400">3.</span> Relaunch Chrome</li>
            <li class="flex gap-3"><span class="font-bold text-cyan-400">4.</span> Navigate to this page and open ChatGPT in the sidebar</li>
            <li class="flex gap-3"><span class="font-bold text-cyan-400">5.</span> Ask ChatGPT to scan a website for agent readiness</li>
          </ol>
        </div>
        <div class="rounded-xl border border-slate-700/40 bg-slate-900/50 p-8">
          <div class="flex h-12 w-12 items-center justify-center rounded-lg bg-emerald-500/10">
            <svg class="h-6 w-6 text-emerald-400" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" /></svg>
          </div>
          <h3 class="mt-4 text-xl font-semibold text-white">ChatGPT In-App Browser</h3>
          <ol class="mt-4 space-y-3 text-sm text-slate-400">
            <li class="flex gap-3"><span class="font-bold text-emerald-400">1.</span> Open ChatGPT on desktop</li>
            <li class="flex gap-3"><span class="font-bold text-emerald-400">2.</span> Use the in-app browser to navigate to this page</li>
            <li class="flex gap-3"><span class="font-bold text-emerald-400">3.</span> ChatGPT will discover available WebMCP tools automatically</li>
            <li class="flex gap-3"><span class="font-bold text-emerald-400">4.</span> Ask ChatGPT to use any of the six tools — e.g., "scan example.com for agent readiness"</li>
            <li class="flex gap-3"><span class="font-bold text-emerald-400">5.</span> The tool executes via <code class="rounded bg-slate-800 px-1.5 py-0.5 text-xs text-emerald-300">document.modelContext</code> and returns results</li>
          </ol>
        </div>
      </div>
    </div>
  </section>`;
}

function WebMcpDiscovery() {
  return html`<section class="mx-auto max-w-6xl px-6 py-20 sm:px-8 lg:px-12">
    <div class="rounded-xl border border-slate-700/40 bg-slate-950/50 p-8">
      <h2 class="text-2xl font-bold text-white sm:text-3xl">Discovery Endpoint</h2>
      <p class="mt-4 text-slate-400">Agents discover available tools via the WebMCP discovery manifest.</p>
      <div class="mt-6 rounded-lg border border-slate-700/40 bg-slate-900/80 p-4">
        <div class="flex items-center gap-2 text-sm text-slate-400">
          <span class="rounded bg-emerald-500/10 px-2 py-0.5 font-mono text-xs text-emerald-400">GET</span>
          <code class="font-mono text-indigo-300">/.well-known/webmcp.json</code>
        </div>
        <pre class="mt-4 overflow-x-auto text-xs text-slate-400"><code>{
  "tools": [
    {
      "name": "agent-readiness-scan",
      "description": "Scan a website for AI agent readiness compliance.",
      "readOnly": true,
      "untrusted": true,
      "endpoint": "/api/scan"
    },
    ...
  ]
}</code></pre>
      </div>
      <div class="mt-4">
        <a href="/.well-known/webmcp.json" class="inline-flex items-center gap-2 text-sm font-medium text-indigo-400 hover:text-indigo-300">
          View live discovery manifest
          <svg class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M14 5l7 7m0 0l-7 7m7-7H3" /></svg>
        </a>
      </div>
    </div>
    ${raw(injectWebMCP(allTools))}
  </section>`;
}

function WebMcpCtaFooter() {
  return html`<section class="mx-auto max-w-6xl px-6 py-20 sm:px-8 lg:px-12">
    <div class="rounded-2xl border border-indigo-600/25 bg-gradient-to-br from-indigo-950/40 to-slate-950 p-12 text-center">
      <h2 class="text-3xl font-bold text-white sm:text-4xl">Agent-Native Compliance Starts Here</h2>
      <p class="mx-auto mt-4 max-w-2xl text-slate-300">
        AgentBadge exposes six imperative tools and one declarative form through WebMCP.
        AI agents discover, scan, verify, and issue passports — all without leaving the page.
      </p>
      <div class="mt-8 flex flex-col items-center justify-center gap-4 sm:flex-row">
        <a href="/dashboard" class="rounded-xl bg-indigo-500 px-6 py-3 text-base font-semibold text-white shadow-lg shadow-indigo-500/25 transition-all hover:bg-indigo-400">
          View Dashboard
        </a>
        <a href="/agent-guide" class="rounded-xl border border-slate-700 bg-slate-800/50 px-6 py-3 text-base font-semibold text-slate-200 transition-all hover:border-slate-600 hover:bg-slate-800">
          Agent Guide
        </a>
        <a href="/" class="rounded-xl border border-slate-700 bg-slate-800/50 px-6 py-3 text-base font-semibold text-slate-200 transition-all hover:border-slate-600 hover:bg-slate-800">
          Back to Home
        </a>
      </div>
    </div>
  </section>`;
}
