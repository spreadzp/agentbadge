import { html, raw } from "hono/html";
import { Layout } from "../chrome/layout";
import { agentsPageTools } from "../../server/lib/agent-interaction/webmcp-page-tools";
import { pageCoreSchemas, webPageLd, breadcrumbFor } from "../../server/lib/json-ld";

/**
 * EPIC-233 (SLICE-233-6): /for-agents — the browser-agent carrier
 * page. webmcpPageScope injects exactly the 5 keyless agent-interaction
 * tools (agentsPageTools) via document.modelContext; the page itself
 * documents the shelf + points at the MCP endpoint and manifest.
 */
export function AgentsPage(jsonLd?: object[]) {
  const tools = agentsPageTools();

  const toolCard = (t: (typeof tools)[number]) => html`
    <div class="rounded-xl border border-slate-700/40 bg-slate-900/50 p-6">
      <h3 class="font-mono text-lg font-semibold text-white">${t.name}</h3>
      <p class="mt-2 text-sm text-slate-400">${t.description}</p>
      <div class="mt-3 rounded bg-slate-950/50 px-3 py-1.5 text-xs font-mono text-slate-500">${t.endpoint.method} ${t.endpoint.path}</div>
    </div>`;

  const content = html`
    <section class="mx-auto max-w-6xl px-6 py-20 sm:px-8 lg:px-12">
      <div class="max-w-3xl">
        <span class="inline-block rounded-full border border-indigo-600/30 bg-indigo-500/10 px-4 py-1.5 text-sm font-medium text-indigo-300">
          Agent Protocol Surface
        </span>
        <h1 class="mt-6 text-4xl font-bold tracking-tight text-white sm:text-5xl">
          AgentBadge for Agents
        </h1>
        <p class="mt-6 text-lg text-slate-300">
          This page exposes ${tools.length} keyless tools through the browser's
          <code class="rounded bg-slate-800 px-1.5 py-0.5 text-sm text-indigo-300">document.modelContext</code>
          interface (WebMCP). No API key, no signup — browser agents can discover,
          search, ask, and file requests directly from the page context.
        </p>
      </div>
      <div class="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        ${raw(tools.map((t) => toolCard(t).toString()).join(""))}
      </div>
      <div class="mt-12 rounded-xl border border-slate-700/40 bg-slate-950/50 p-8">
        <h2 class="text-2xl font-bold text-white sm:text-3xl">Other surfaces</h2>
        <div class="mt-6 space-y-3 text-sm text-slate-400">
          <p>
            <span class="rounded bg-emerald-500/10 px-2 py-0.5 font-mono text-xs text-emerald-400">MCP</span>
            <code class="ml-2 font-mono text-indigo-300">POST /mcp/agent-interaction</code>
            — the same tools plus verified-agent writes via an optional Bearer agb_ key.
          </p>
          <p>
            <span class="rounded bg-cyan-500/10 px-2 py-0.5 font-mono text-xs text-cyan-400">JSON</span>
            <a href="/.well-known/agent-interaction.json" class="ml-2 font-mono text-indigo-400 hover:text-indigo-300">/.well-known/agent-interaction.json</a>
            — the full capability manifest.
          </p>
          <p>
            <span class="rounded bg-purple-500/10 px-2 py-0.5 font-mono text-xs text-purple-400">DOCS</span>
            <a href="/agent-guide" class="ml-2 font-mono text-indigo-400 hover:text-indigo-300">/agent-guide</a>
            — the human-readable agent onboarding guide.
          </p>
        </div>
      </div>
    </section>`;

  const schemas = [
    ...pageCoreSchemas(),
    webPageLd({
      title: "AgentBadge for Agents",
      description:
        "Keyless WebMCP tool surface for browser agents: discover, search, ask, and file requests with no API key.",
      path: "/for-agents",
    }),
    breadcrumbFor("/for-agents", "For Agents"),
  ];

  return Layout(
    content.toString(),
    "AgentBadge for Agents",
    {
      title: "AgentBadge for Agents — Keyless WebMCP Tools",
      description:
        "Keyless WebMCP tool surface for browser agents: discover, search knowledge, ask questions, and file requests — no API key required.",
      path: "/for-agents",
    },
    jsonLd ?? schemas,
  );
}
