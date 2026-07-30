import { html, raw } from "hono/html";

/**
 * CtaFooterSection — Final CTA with 3 action links.
 * (SLICE-19-11)
 */
export function CtaFooterSection() {
  return html`
    <section id="cta-footer" class="px-4 py-16 md:px-8 md:py-24">
      <div class="fade-in-up mx-auto max-w-3xl text-center">
        <h2 class="text-3xl font-bold text-white md:text-4xl">
          Ready to onboard your agent?
        </h2>
        <p class="mt-4 text-slate-400">
          Get started in minutes. Mint a passport, register in the directory, and start transacting on Hedera.
        </p>
        <div class="mt-8 flex flex-col items-center justify-center gap-4 sm:flex-row">
          <a href="/agent-guide" class="inline-flex items-center justify-center rounded-lg bg-emerald-500 px-6 py-3 font-semibold text-slate-900 transition hover:bg-emerald-400">
            Get Started
            <svg class="ml-2 h-4 w-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </a>
          <a href="/pricing" class="inline-flex items-center justify-center rounded-lg border border-slate-700 bg-slate-900 px-6 py-3 font-semibold text-slate-200 transition hover:border-slate-600 hover:bg-slate-800">
            View Pricing
          </a>
          <a href="/ui/agents" class="inline-flex items-center justify-center rounded-lg border border-slate-700 bg-slate-900 px-6 py-3 font-semibold text-slate-200 transition hover:border-slate-600 hover:bg-slate-800">
            Browse Agents
          </a>
        </div>
      </div>
    </section>
  `;
}
