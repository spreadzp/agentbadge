import { html } from "hono/html";

/**
 * ReadinessKnowledgeSection — "Agent Knowledge Layer" section with
 * product description, bullet list, endpoint mock, and CTA.
 * SLICE-43-5
 *
 * Content:
 * - Eyebrow: "Agent Knowledge Layer"
 * - H2: "The product is machine-readable too."
 * - Description paragraph
 * - Bullet list: product context, knowledge map, scanner/CLI, concepts, endpoints
 * - Endpoint mock: GET /agent-guide/ → 200 OK with links
 * - CTA: "Open Agent Knowledge Layer →"
 */
export function ReadinessKnowledgeSection() {
  return html`
    <section id="agents" class="px-4 py-20 md:px-8 border-t border-white/5">
      <div class="mx-auto max-w-6xl">
        <div class="grid gap-8 lg:grid-cols-2 lg:items-start">
          <!-- Left: description + bullets -->
          <div>
            <div class="text-xs font-mono uppercase tracking-widest text-emerald-400">
              Agent Knowledge Layer
            </div>
            <h2 class="mt-2 text-3xl md:text-4xl font-bold tracking-tight leading-tight">
              The product is machine-readable too.
            </h2>
            <p class="mt-4 text-slate-400 text-lg">
              AI agents should not have to reverse-engineer a marketing site. AgentBadge exposes a structured knowledge layer that lets an agent discover the product, understand capabilities and choose the right action.
            </p>
            <ul class="mt-6 space-y-2 text-slate-300">
              <li class="flex items-start gap-2">
                <span class="text-emerald-400 mt-1">▸</span>
                Product context and onboarding
              </li>
              <li class="flex items-start gap-2">
                <span class="text-emerald-400 mt-1">▸</span>
                Knowledge map connecting concepts and capabilities
              </li>
              <li class="flex items-start gap-2">
                <span class="text-emerald-400 mt-1">▸</span>
                Scanner and CLI instructions
              </li>
              <li class="flex items-start gap-2">
                <span class="text-emerald-400 mt-1">▸</span>
                Machine-readable concepts and reports
              </li>
              <li class="flex items-start gap-2">
                <span class="text-emerald-400 mt-1">▸</span>
                Article-specific agent knowledge endpoints
              </li>
            </ul>
            <a href="/agent-guide/" class="mt-6 inline-flex items-center gap-2 text-emerald-400 font-semibold hover:text-emerald-300 transition-colors">
              Open Agent Knowledge Layer
              <svg class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </a>
          </div>

          <!-- Right: endpoint mock -->
          <div class="rounded-lg border border-slate-700 bg-slate-950 p-6 font-mono text-[13px] leading-relaxed text-slate-300">
            <div class="flex items-center gap-2 mb-4">
              <span class="rounded bg-emerald-400/10 text-emerald-400 px-2 py-0.5 text-xs font-bold">GET</span>
              <span class="text-slate-200">/agent-guide/</span>
              <span class="ml-auto text-emerald-400 text-xs">200 OK</span>
            </div>
            <div class="text-slate-500 mb-2">machine-readable index</div>
            <div class="space-y-1.5 text-slate-400">
              <div>→ /context</div>
              <div>→ /learn</div>
              <div>→ /knowledge-map.json</div>
              <div>→ /concepts/scoring</div>
              <div>→ /capabilities/scanner</div>
              <div>→ /capabilities/cli</div>
            </div>
          </div>
        </div>

        <div class="mt-8 text-center text-slate-500 text-sm">
          Designed for humans to read and agents to navigate.
        </div>
      </div>
    </section>
  `;
}
