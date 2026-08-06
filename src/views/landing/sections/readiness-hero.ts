import { html } from "hono/html";

/**
 * ReadinessHeroSection — hero section for the Agent Readiness landing page.
 * SLICE-43-2
 *
 * Content:
 * - Eyebrow: "Agent Readiness Infrastructure"
 * - H1: "Can an AI agent actually use your API?"
 * - Subtitle with product description
 * - 2 CTAs: Scan free → /agent-guide/articles/what-is-agent-readiness, See how it works → #how
 * - Mock scan terminal panel with sample results
 */
export function ReadinessHeroSection() {
  return html`
    <section id="scan" class="relative overflow-hidden px-4 py-20 md:px-8 md:py-28">
      <div class="mx-auto max-w-6xl grid gap-10 md:grid-cols-[1.05fr_0.95fr] md:gap-14 md:items-center">
        <!-- Left: copy -->
        <div>
          <div class="text-xs font-mono uppercase tracking-widest text-emerald-400">
            Agent Readiness Infrastructure
          </div>
          <h1 class="mt-4 text-5xl md:text-7xl font-extrabold leading-none tracking-tight max-w-2xl">
            Can an AI agent actually <em class="not-italic text-emerald-400">use your API?</em>
          </h1>
          <p class="mt-6 text-lg text-slate-400 max-w-xl">
            AgentBadge measures whether your API can be discovered, understood and used by AI agents —
            with deterministic checks, evidence and actionable fixes.
          </p>
          <div class="mt-7 flex flex-wrap gap-3">
            <a href="/agent-guide/articles/what-is-agent-readiness" class="inline-flex items-center gap-2 rounded-lg bg-emerald-400 px-5 py-3 font-bold text-slate-950 border border-emerald-400 hover:translate-y-[-1px] transition-transform">
              Scan free →
            </a>
            <a href="#how" class="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-5 py-3 font-bold text-slate-100 border border-slate-700 hover:translate-y-[-1px] transition-transform">
              See how it works
            </a>
          </div>
          <div class="mt-3 text-xs text-slate-500 font-mono">
            No signup · passive scan · results in seconds
          </div>
        </div>

        <!-- Right: mock scan terminal -->
        <div class="rounded-xl border border-slate-700 bg-gradient-to-b from-slate-900 to-slate-950 shadow-2xl overflow-hidden">
          <!-- Terminal bar -->
          <div class="h-9 border-b border-slate-700 flex items-center px-4 gap-2">
            <span class="w-2 h-2 rounded-full bg-red-400"></span>
            <span class="w-2 h-2 rounded-full bg-amber-400"></span>
            <span class="w-2 h-2 rounded-full bg-emerald-400"></span>
            <span class="ml-2 text-xs text-slate-500 font-mono">agentbadge scan</span>
          </div>
          <!-- Terminal body -->
          <div class="p-5 font-mono text-[13px] leading-loose">
            <div class="text-slate-500">$ agentbadge scan https://api.example.com</div>
            <div class="text-emerald-400">✓ discovery /openapi.json</div>
            <div class="text-emerald-400">✓ OpenAPI schema detected</div>
            <div class="text-emerald-400">✓ authentication documented</div>
            <div class="text-red-400">✗ structured error schema missing</div>
            <div class="text-amber-400">◐ capability description inferred</div>
            <!-- Score box -->
            <div class="mt-4 pt-4 border-t border-slate-700 flex items-end justify-between">
              <div>
                <span class="text-slate-500 text-xs">AGENT READINESS</span><br>
                <span class="text-5xl text-emerald-400 leading-none">76</span>
                <span class="text-slate-500"> / 100</span>
              </div>
              <div class="text-emerald-400 font-mono">+8 after fix</div>
            </div>
          </div>
        </div>
      </div>
    </section>
  `;
}
