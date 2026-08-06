import { html } from "hono/html";

/**
 * ReadinessPricingSection — "Business model" section with
 * Free, Pro, and Enterprise pricing tiers.
 * SLICE-43-6
 *
 * Content:
 * - Eyebrow: "Business model"
 * - H2: "Free measurement. Paid automation and continuity."
 * - 3 pricing cards: Free ($0), Pro ($9/domain/mo, recommended), Enterprise (custom)
 */
export function ReadinessPricingSection() {
  return html`
    <section id="pricing" class="px-4 py-20 md:px-8 border-t border-white/5">
      <div class="mx-auto max-w-6xl">
        <!-- Section head -->
        <div class="max-w-3xl mb-10">
          <div class="text-xs font-mono uppercase tracking-widest text-emerald-400">
            Business model
          </div>
          <h2 class="mt-2 text-3xl md:text-4xl font-bold tracking-tight leading-tight">
            Free measurement. Paid automation and continuity.
          </h2>
          <p class="mt-4 text-slate-400 text-lg">
            The measurement layer stays open and useful. Revenue comes from continuous monitoring, CI automation, active verification, integrations and enterprise workflows.
          </p>
        </div>

        <!-- 3 pricing cards -->
        <div class="grid gap-5 md:grid-cols-3">
          <!-- Free -->
          <div class="rounded-lg border border-slate-700 bg-slate-900/50 p-6">
            <h3 class="text-lg font-semibold mb-1">Free</h3>
            <div class="text-2xl font-bold text-slate-200 mb-4">$0 <span class="text-sm font-normal text-slate-500">forever</span></div>
            <ul class="space-y-2 text-sm text-slate-400 mb-6">
              <li class="flex items-start gap-2"><span class="text-emerald-400 mt-0.5">✓</span> Public passive scan</li>
              <li class="flex items-start gap-2"><span class="text-emerald-400 mt-0.5">✓</span> Score + evidence</li>
              <li class="flex items-start gap-2"><span class="text-emerald-400 mt-0.5">✓</span> CLI</li>
              <li class="flex items-start gap-2"><span class="text-emerald-400 mt-0.5">✓</span> Badge</li>
              <li class="flex items-start gap-2"><span class="text-emerald-400 mt-0.5">✓</span> Open ruleset</li>
            </ul>
            <a href="#scan" class="inline-flex items-center justify-center rounded-lg bg-slate-900 px-5 py-3 font-semibold text-slate-200 border border-slate-700 transition-colors hover:border-emerald-500 hover:text-emerald-400 text-sm w-full">
              Scan free →
            </a>
          </div>

          <!-- Pro (recommended) -->
          <div class="rounded-lg border-2 border-emerald-500 bg-slate-900/50 p-6 relative">
            <div class="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-emerald-500 px-3 py-0.5 text-xs font-bold text-slate-950">recommended</div>
            <h3 class="text-lg font-semibold mb-1">Pro</h3>
            <div class="text-2xl font-bold text-slate-200 mb-4">$9 <span class="text-sm font-normal text-slate-500">/ domain / mo</span></div>
            <ul class="space-y-2 text-sm text-slate-400 mb-6">
              <li class="flex items-start gap-2"><span class="text-emerald-400 mt-0.5">✓</span> Continuous monitoring</li>
              <li class="flex items-start gap-2"><span class="text-emerald-400 mt-0.5">✓</span> Regression alerts</li>
              <li class="flex items-start gap-2"><span class="text-emerald-400 mt-0.5">✓</span> Score history + trends</li>
              <li class="flex items-start gap-2"><span class="text-emerald-400 mt-0.5">✓</span> Fresh badge / no stale state</li>
              <li class="flex items-start gap-2"><span class="text-emerald-400 mt-0.5">✓</span> CI integrations</li>
            </ul>
            <a href="#" class="inline-flex items-center justify-center rounded-lg bg-emerald-500 px-5 py-3 font-semibold text-slate-950 transition-colors hover:bg-emerald-400 text-sm w-full">
              Start monitoring →
            </a>
          </div>

          <!-- Enterprise -->
          <div class="rounded-lg border border-slate-700 bg-slate-900/50 p-6">
            <h3 class="text-lg font-semibold mb-1">Enterprise</h3>
            <div class="text-2xl font-bold text-slate-200 mb-4">Custom</div>
            <ul class="space-y-2 text-sm text-slate-400 mb-6">
              <li class="flex items-start gap-2"><span class="text-emerald-400 mt-0.5">✓</span> Active verification</li>
              <li class="flex items-start gap-2"><span class="text-emerald-400 mt-0.5">✓</span> SSO / audit reports</li>
              <li class="flex items-start gap-2"><span class="text-emerald-400 mt-0.5">✓</span> Private rulesets</li>
              <li class="flex items-start gap-2"><span class="text-emerald-400 mt-0.5">✓</span> SLA / dedicated support</li>
              <li class="flex items-start gap-2"><span class="text-emerald-400 mt-0.5">✓</span> B2B API / bulk scoring</li>
            </ul>
            <a href="#" class="inline-flex items-center justify-center rounded-lg bg-slate-900 px-5 py-3 font-semibold text-slate-200 border border-slate-700 transition-colors hover:border-emerald-500 hover:text-emerald-400 text-sm w-full">
              Talk to us →
            </a>
          </div>
        </div>
      </div>
    </section>
  `;
}
