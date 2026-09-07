import { html } from "hono/html";

/**
 * ReadinessPassportSecondarySection — "Verify Agent Identity" — Passport as
 * secondary product. Explains relationship between Agent Readiness and Agent Passport.
 * SLICE-110-7
 */
export function ReadinessPassportSecondarySection() {
  return html`
    <section class="px-4 py-16 md:px-8 md:py-20 border-t border-slate-800/50">
      <div class="mx-auto max-w-4xl text-center">
        <div class="text-xs font-mono uppercase tracking-widest text-emerald-400">
          Agent Passport
        </div>
        <h2 class="mt-3 text-3xl md:text-4xl font-bold text-white">
          Verify Agent Identity
        </h2>
        <p class="mt-6 text-slate-400 text-lg max-w-2xl mx-auto">
          Agent Readiness tells whether an agent can <em class="text-emerald-400 not-italic">use</em> your API.
          Agent Passport helps establish <em class="text-emerald-400 not-italic">verifiable identity</em>
          — so you know who's calling.
        </p>
        <div class="mt-8">
          <a
            href="/passport"
            class="inline-flex items-center justify-center rounded-lg border border-emerald-500/50 bg-emerald-500/10 px-6 py-3 text-sm font-semibold text-emerald-400 transition-colors hover:bg-emerald-500/20"
          >
            Learn about Agent Passports
            <svg class="ml-2 h-4 w-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </a>
        </div>
      </div>
    </section>
  `;
}
