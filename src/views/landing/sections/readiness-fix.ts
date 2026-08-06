import { html } from "hono/html";

/**
 * ReadinessFixSection — "From diagnosis to outcome" section with
 * Type A (deterministic, safe to automate) and Type B (assisted, human confirms) fix cards.
 * SLICE-43-4
 *
 * Content:
 * - Eyebrow: "From diagnosis to outcome"
 * - H2: "Don't just tell developers what's broken. Help them fix it."
 * - Type A card: deterministic fix with diff showing +8 score improvement
 * - Type B card: assisted fix with AI proposal and Confirm/Edit/Reject buttons
 */
export function ReadinessFixSection() {
  return html`
    <section id="fix" class="px-4 py-20 md:px-8 border-t border-white/5">
      <div class="mx-auto max-w-6xl">
        <!-- Section head -->
        <div class="max-w-3xl mb-10">
          <div class="text-xs font-mono uppercase tracking-widest text-emerald-400">
            From diagnosis to outcome
          </div>
          <h2 class="mt-2 text-3xl md:text-4xl font-bold tracking-tight leading-tight">
            Don't just tell developers what's broken. Help them fix it.
          </h2>
          <p class="mt-4 text-slate-400 text-lg">
            The core product loop is Measure → Prove → Improve. Safe fixes can be automated; semantic changes stay assisted.
          </p>
        </div>

        <!-- Fix grid: Type A + Type B -->
        <div class="grid gap-5 lg:grid-cols-2">
          <!-- Type A: Deterministic -->
          <div class="rounded-lg border border-slate-700 bg-slate-900/50 p-6">
            <div class="text-xs font-mono text-emerald-400 mb-4">TYPE A / DETERMINISTIC</div>
            <h3 class="text-lg font-semibold mb-2">Safe to automate</h3>
            <p class="text-slate-400 text-sm mb-4">Known, mechanically verifiable changes.</p>
            <div class="font-mono text-[13px] leading-relaxed bg-slate-950 border border-slate-800 rounded-lg p-4">
              <div class="text-emerald-400">+ add /agent-guide.json</div>
              <div class="text-emerald-400">+ add machine-readable metadata</div>
              <div class="text-emerald-400">+ update badge configuration</div>
              <div class="mt-3">
                <span class="text-emerald-400">76 → 84</span>
                <span class="text-slate-500">&nbsp;&nbsp;+8 Guide added</span>
              </div>
            </div>
          </div>

          <!-- Type B: Assisted -->
          <div class="rounded-lg border border-slate-700 bg-slate-900/50 p-6">
            <div class="text-xs font-mono text-emerald-400 mb-4">TYPE B / ASSISTED</div>
            <h3 class="text-lg font-semibold mb-2">Human confirms semantics</h3>
            <p class="text-slate-400 text-sm mb-4">AI proposes; the API owner decides.</p>
            <div class="font-mono text-[13px] leading-relaxed bg-slate-950 border border-slate-800 rounded-lg p-4">
              <div class="text-amber-400">INFERRED · confidence 0.71</div>
              <div class="text-slate-300">POST /refund</div>
              <div class="text-slate-500">"Refund a completed payment"</div>
              <div class="mt-4 flex gap-2 flex-wrap">
                <button class="inline-flex items-center gap-2 rounded-lg bg-emerald-400 px-4 py-2 font-bold text-slate-950 border border-emerald-400 text-sm">Confirm</button>
                <button class="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 font-bold text-slate-100 border border-slate-700 text-sm">Edit</button>
                <button class="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 font-bold text-slate-100 border border-slate-700 text-sm">Reject</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  `;
}
