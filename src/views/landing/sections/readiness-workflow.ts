import { html } from "hono/html";

/**
 * ReadinessWorkflowSection — "Developer workflow" section with
 * CLI, GitHub Action, and Badge cards.
 * SLICE-43-5
 *
 * Content:
 * - Eyebrow: "Developer workflow"
 * - H2: "Works where developers already work."
 * - 3 cards: CLI (run locally), GitHub Action (CI regressions), Badge (show score)
 */
export function ReadinessWorkflowSection() {
  return html`
    <section id="workflow" class="px-4 py-20 md:px-8 border-t border-white/5">
      <div class="mx-auto max-w-6xl">
        <!-- Section head -->
        <div class="max-w-3xl mb-10">
          <div class="text-xs font-mono uppercase tracking-widest text-emerald-400">
            Developer workflow
          </div>
          <h2 class="mt-2 text-3xl md:text-4xl font-bold tracking-tight leading-tight">
            Works where developers already work.
          </h2>
        </div>

        <!-- 3 workflow cards -->
        <div class="grid gap-5 md:grid-cols-3">
          <div class="rounded-lg border border-slate-700 bg-slate-900/50 p-6">
            <div class="text-xs font-mono text-emerald-400 mb-4">CLI</div>
            <h3 class="text-lg font-semibold mb-2">Run locally</h3>
            <p class="text-slate-400 text-sm mb-4">Scan an API without installing an agent or changing your backend.</p>
            <code class="block font-mono text-[13px] leading-relaxed bg-slate-950 border border-slate-800 rounded-lg p-3 text-slate-300">npx @agentbadge/cli scan URL</code>
          </div>
          <div class="rounded-lg border border-slate-700 bg-slate-900/50 p-6">
            <div class="text-xs font-mono text-emerald-400 mb-4">GITHUB ACTION</div>
            <h3 class="text-lg font-semibold mb-2">Catch regressions in CI</h3>
            <p class="text-slate-400 text-sm mb-4">Use score thresholds and machine-readable reports before deployment.</p>
            <code class="block font-mono text-[13px] leading-relaxed bg-slate-950 border border-slate-800 rounded-lg p-3 text-slate-300">uses: agentbadge/scan-action@v1</code>
          </div>
          <div class="rounded-lg border border-slate-700 bg-slate-900/50 p-6">
            <div class="text-xs font-mono text-emerald-400 mb-4">BADGE</div>
            <h3 class="text-lg font-semibold mb-2">Show measured readiness</h3>
            <p class="text-slate-400 text-sm mb-4">Put the current score in your README. Measurement becomes part of your public developer presence.</p>
            <code class="block font-mono text-[13px] leading-relaxed bg-slate-950 border border-slate-800 rounded-lg p-3 text-slate-300">Agent Ready · 91/100</code>
          </div>
        </div>
      </div>
    </section>
  `;
}
