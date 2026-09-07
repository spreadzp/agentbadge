import { html, raw } from "hono/html";

/**
 * ReadinessAgentReadyProofSection — "We don't just measure Agent Readiness.
 * We built AgentBadge to be agent-ready." Live checklist of agent-ready features.
 * SLICE-110-5
 */
export function ReadinessAgentReadyProofSection() {
  const items = [
    { label: "/llms.txt", desc: "AI agent discovery manifest", href: "/llms.txt" },
    { label: "/agent-guide", desc: "Step-by-step integration guide", href: "/agent-guide" },
    { label: "/openapi.json", desc: "Machine-readable API specification", href: "/openapi.json" },
    { label: "/.well-known/webmcp.json", desc: "WebMCP server descriptor", href: "/.well-known/webmcp.json" },
    { label: "WebMCP tools", desc: "navigator.modelContext protocol support" },
    { label: "Machine-readable rules", desc: "145+ checks published as structured data", href: "/api/rules" },
  ];

  return html`
    <section class="px-4 py-16 md:px-8 md:py-20 border-t border-slate-800/50">
      <div class="mx-auto max-w-6xl">
        <div class="grid gap-10 md:grid-cols-[1fr_1fr] md:items-center">
          <!-- Left: statement -->
          <div>
            <div class="text-xs font-mono uppercase tracking-widest text-emerald-400">
              Agent-Ready Proof
            </div>
            <h2 class="mt-3 text-3xl md:text-4xl font-bold text-white leading-tight">
              We don't just measure Agent Readiness.
              <span class="text-emerald-400">We built AgentBadge to be agent-ready.</span>
            </h2>
            <p class="mt-4 text-slate-400 max-w-lg">
              Every feature we check on your API, we implement ourselves.
              Our own infrastructure passes the same scanner we run on you.
            </p>
          </div>

          <!-- Right: checklist -->
          <div class="rounded-xl border border-slate-700/50 bg-slate-900/40 p-6">
            <div class="text-sm font-semibold text-slate-300 mb-4">
              AgentBadge's own agent-ready endpoints:
            </div>
            <ul class="space-y-3">
              ${raw(
                items
                  .map(
                    (item) => `
              <li class="flex items-start gap-3">
                <span class="text-emerald-400 text-lg leading-none mt-0.5">✓</span>
                <div>
                  ${item.href ? `<a href="${item.href}" class="text-sm font-mono text-emerald-400 underline hover:text-emerald-300">${item.label}</a>` : `<span class="text-sm font-mono text-white">${item.label}</span>`}
                  <span class="text-xs text-slate-500 ml-2">${item.desc}</span>
                </div>
              </li>`,
                  )
                  .join(""),
              )}
            </ul>
          </div>
        </div>
      </div>
    </section>
  `;
}
