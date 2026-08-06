import { html } from "hono/html";

/**
 * ReadinessAudienceSection — "Who buys" section with 4 buyer cards.
 * SLICE-43-6
 *
 * Content:
 * - Eyebrow: "Who buys"
 * - H2: "One infrastructure layer. Several buyers."
 * - 4 cards: API & SaaS owners, Agent platforms & marketplaces,
 *   Enterprise engineering teams, AI-native developers
 */
export function ReadinessAudienceSection() {
  return html`
    <section id="audience" class="px-4 py-20 md:px-8 border-t border-white/5">
      <div class="mx-auto max-w-6xl">
        <!-- Section head -->
        <div class="max-w-3xl mb-10">
          <div class="text-xs font-mono uppercase tracking-widest text-emerald-400">
            Who buys
          </div>
          <h2 class="mt-2 text-3xl md:text-4xl font-bold tracking-tight leading-tight">
            One infrastructure layer. Several buyers.
          </h2>
        </div>

        <!-- 4 audience cards -->
        <div class="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          <div class="rounded-lg border border-slate-700 bg-slate-900/50 p-6">
            <h3 class="text-base font-semibold mb-2">API &amp; SaaS owners</h3>
            <p class="text-sm text-slate-400 m-0">Want AI agents to discover and reliably use their products. Free scan creates the entry point; monitoring and fixes create recurring value.</p>
          </div>
          <div class="rounded-lg border border-slate-700 bg-slate-900/50 p-6">
            <h3 class="text-base font-semibold mb-2">Agent platforms &amp; marketplaces</h3>
            <p class="text-sm text-slate-400 m-0">Need an independent signal for ranking, filtering and evaluating APIs. B2B API access turns Agent Readiness into infrastructure.</p>
          </div>
          <div class="rounded-lg border border-slate-700 bg-slate-900/50 p-6">
            <h3 class="text-base font-semibold mb-2">Enterprise engineering teams</h3>
            <p class="text-sm text-slate-400 m-0">Need reproducible reports, CI gates, auditability and controlled verification for third-party APIs.</p>
          </div>
          <div class="rounded-lg border border-slate-700 bg-slate-900/50 p-6">
            <h3 class="text-base font-semibold mb-2">AI-native developers</h3>
            <p class="text-sm text-slate-400 m-0">Use CLI and GitHub workflows to prevent agent-readiness regressions as APIs evolve.</p>
          </div>
        </div>
      </div>
    </section>
  `;
}
