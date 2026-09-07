import { html, raw } from "hono/html";

interface ProofCard {
  label: string;
  url: string;
  description: string;
  icon: string;
  status: string;
}

const PROOF_CARDS: ProofCard[] = [
  {
    label: "robots.txt",
    url: "/robots.txt",
    description: "Allows AI bots to crawl. Agent-friendly directives.",
    icon: "🤖",
    status: "200 OK",
  },
  {
    label: "llms.txt",
    url: "/llms.txt",
    description: "Structured LLM entry point. Capabilities, endpoints, guides.",
    icon: "📝",
    status: "200 OK",
  },
  {
    label: "openapi.json",
    url: "/openapi.json",
    description: "Full OpenAPI spec. 30+ endpoints documented.",
    icon: "📐",
    status: "200 OK",
  },
  {
    label: "MCP Server",
    url: "/hackathon/webmcp",
    description: "WebMCP with 6 tools: scan, badge, passport, verify, score, search.",
    icon: "🔌",
    status: "6 tools",
  },
  {
    label: "Agent Guide",
    url: "/agent-guide/",
    description: "Knowledge layer for AI agents. Articles, concepts, capabilities.",
    icon: "📚",
    status: "Live",
  },
  {
    label: "knowledge-map.json",
    url: "/agent-guide/knowledge-map.json",
    description: "Machine-readable concept graph. Structured for agent consumption.",
    icon: "🗺️",
    status: "200 OK",
  },
];

export function AgentReadyProofSection() {
  return html`
    <section id="agent-ready-proof" class="px-4 py-20 md:px-8 border-t border-white/5">
      <div class="mx-auto max-w-6xl">
        <!-- Headline -->
        <div class="max-w-3xl mb-10">
          <div class="text-xs font-mono uppercase tracking-widest text-emerald-400">
            We practice what we measure
          </div>
          <h2 class="mt-2 text-3xl md:text-4xl font-bold tracking-tight leading-tight text-white">
            We don't just measure Agent Readiness. We built AgentBadge to be agent-ready.
          </h2>
          <p class="mt-4 text-slate-400 text-lg">
            Every endpoint below is live. Click any card to verify.
          </p>
        </div>

        <!-- Evidence cards grid -->
        <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          ${raw(PROOF_CARDS.map((card) => html`
            <a href="${card.url}" class="group block rounded-xl border border-slate-800 bg-slate-900/50 p-5 transition-all hover:border-emerald-500/50 hover:bg-slate-900">
              <div class="flex items-start justify-between">
                <div class="text-2xl">${card.icon}</div>
                <span class="text-xs font-mono text-emerald-400 border border-emerald-500/30 rounded px-2 py-0.5">
                  ${card.status}
                </span>
              </div>
              <h3 class="mt-3 text-lg font-semibold text-white group-hover:text-emerald-400">
                ${card.label}
              </h3>
              <p class="mt-1 text-sm text-slate-400">${card.description}</p>
              <div class="mt-3 text-xs font-mono text-slate-500 group-hover:text-emerald-400">
                ${card.url} →
              </div>
            </a>
          `).join(""))}
        </div>

        <!-- CTA -->
        <div class="mt-10 text-center">
          <a href="/hackathon/webmcp" class="inline-flex items-center justify-center rounded-lg bg-emerald-500 px-8 py-4 text-base font-semibold text-white transition-colors hover:bg-emerald-400">
            See the agent architecture
            <svg class="ml-2 h-5 w-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" /></svg>
          </a>
        </div>
      </div>
    </section>
  `;
}
