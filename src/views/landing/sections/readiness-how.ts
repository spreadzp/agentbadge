import { html } from "hono/html";

/**
 * ReadinessHowSection — "How it works" section with problem statement,
 * 4 measurable categories, and the 5-step pipeline.
 * SLICE-43-3
 *
 * Content:
 * - Eyebrow: "The problem"
 * - H2: "Your API can be excellent and still be invisible to agents."
 * - 4 category cards: Discovery, Understanding, Authentication, Action
 * - 5-step pipeline: Scan → Evidence → Score → Fix → Monitor
 */
export function ReadinessHowSection() {
  return html`
    <section id="how" class="px-4 py-20 md:px-8 border-t border-white/5">
      <div class="mx-auto max-w-6xl">
        <!-- Section head -->
        <div class="max-w-3xl mb-10">
          <div class="text-xs font-mono uppercase tracking-widest text-emerald-400">
            The problem
          </div>
          <h2 class="mt-2 text-3xl md:text-4xl font-bold tracking-tight leading-tight">
            Your API can be excellent and still be invisible to agents.
          </h2>
          <p class="mt-4 text-slate-400 text-lg">
            Humans can fill gaps in documentation with context and intuition. Agents need machine-readable signals
            that tell them what exists, how to authenticate, what to call and how to recover from errors.
          </p>
        </div>

        <!-- 4 categories grid -->
        <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div class="rounded-lg border border-slate-700 bg-slate-900/50 p-6">
            <div class="text-xs font-mono text-emerald-400 mb-4">01 / DISCOVERY</div>
            <h3 class="text-base font-semibold mb-2">Can an agent find you?</h3>
            <p class="text-sm text-slate-400 m-0">Machine-readable discovery, well-known resources, documentation and capability signals.</p>
          </div>
          <div class="rounded-lg border border-slate-700 bg-slate-900/50 p-6">
            <div class="text-xs font-mono text-emerald-400 mb-4">02 / UNDERSTANDING</div>
            <h3 class="text-base font-semibold mb-2">Can it understand you?</h3>
            <p class="text-sm text-slate-400 m-0">OpenAPI, endpoint descriptions, parameters, responses and machine-readable semantics.</p>
          </div>
          <div class="rounded-lg border border-slate-700 bg-slate-900/50 p-6">
            <div class="text-xs font-mono text-emerald-400 mb-4">03 / AUTHENTICATION</div>
            <h3 class="text-base font-semibold mb-2">Can it authenticate?</h3>
            <p class="text-sm text-slate-400 m-0">Clear, structured authentication requirements instead of instructions buried in prose.</p>
          </div>
          <div class="rounded-lg border border-slate-700 bg-slate-900/50 p-6">
            <div class="text-xs font-mono text-emerald-400 mb-4">04 / ACTION</div>
            <h3 class="text-base font-semibold mb-2">Can it act reliably?</h3>
            <p class="text-sm text-slate-400 m-0">Structured responses, errors and evidence that reduce guessing and failed calls.</p>
          </div>
        </div>

        <!-- 5-step pipeline -->
        <div class="grid gap-2 mt-8 sm:grid-cols-3 lg:grid-cols-5">
          <div class="rounded-lg border border-slate-700 bg-slate-900/50 p-5 relative">
            <strong class="block text-sm font-mono text-emerald-400 mb-2">SCAN</strong>
            <span class="text-sm text-slate-400">Observe public API signals.</span>
          </div>
          <div class="rounded-lg border border-slate-700 bg-slate-900/50 p-5 relative">
            <strong class="block text-sm font-mono text-emerald-400 mb-2">EVIDENCE</strong>
            <span class="text-sm text-slate-400">Show exactly why a rule passed or failed.</span>
          </div>
          <div class="rounded-lg border border-slate-700 bg-slate-900/50 p-5 relative">
            <strong class="block text-sm font-mono text-emerald-400 mb-2">SCORE</strong>
            <span class="text-sm text-slate-400">One readable score with category breakdown.</span>
          </div>
          <div class="rounded-lg border border-slate-700 bg-slate-900/50 p-5 relative">
            <strong class="block text-sm font-mono text-emerald-400 mb-2">FIX</strong>
            <span class="text-sm text-slate-400">Automate safe fixes, assist with semantic ones.</span>
          </div>
          <div class="rounded-lg border border-slate-700 bg-slate-900/50 p-5 relative">
            <strong class="block text-sm font-mono text-emerald-400 mb-2">MONITOR</strong>
            <span class="text-sm text-slate-400">Catch regressions as APIs change.</span>
          </div>
        </div>
      </div>
    </section>
  `;
}
