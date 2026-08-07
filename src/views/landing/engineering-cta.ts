import { html } from "hono/html";

/**
 * EngineeringCtaSection — "Need more than a score?" block.
 * SLICE-46-8: Promotes team engineering services on the landing page.
 */
export function EngineeringCtaSection() {
  return html`
    <section id="engineering-cta" class="border-t border-slate-800 px-4 py-16 md:px-8 md:py-20">
      <div class="fade-in-up mx-auto max-w-3xl text-center">
        <h2 class="text-2xl font-bold text-white md:text-3xl">
          Need more than a score?
        </h2>
        <p class="mt-4 text-slate-400">
          Our team builds MCP servers, smart contracts, and AI agent systems.
        </p>
        <div class="mt-6 flex flex-col items-center justify-center gap-4 sm:flex-row">
          <a href="/team" class="inline-flex items-center justify-center rounded-lg bg-emerald-500 px-6 py-3 font-semibold text-slate-900 transition hover:bg-emerald-400">
            Learn what we can do for you
            <svg class="ml-2 h-4 w-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </a>
          <a href="/services" class="inline-flex items-center justify-center rounded-lg border border-slate-700 bg-slate-900 px-6 py-3 font-semibold text-slate-200 transition hover:border-slate-600 hover:bg-slate-800">
            View Services
          </a>
        </div>
      </div>
    </section>
  `;
}
