import { html } from "hono/html";

/**
 * ReadinessThesisSection — "The thesis" closing section with final CTA.
 * SLICE-43-6
 *
 * Content:
 * - Eyebrow: "The thesis"
 * - H2: "Measure the new interface between APIs and agents."
 * - Description paragraph
 * - 2 CTAs: "Scan your API free →" and "For AI agents →"
 */
export function ReadinessThesisSection() {
  return html`
    <section id="thesis" class="px-4 py-20 md:px-8 border-t border-white/5">
      <div class="mx-auto max-w-4xl text-center">
        <div class="text-xs font-mono uppercase tracking-widest text-emerald-400">
          The thesis
        </div>
        <h2 class="mt-2 text-3xl md:text-5xl font-bold tracking-tight leading-tight">
          Measure the new interface between APIs and agents.
        </h2>
        <p class="mt-6 text-slate-400 text-lg max-w-2xl mx-auto">
          AgentBadge is not trying to certify the internet. It is building an open measurement standard and the installed workflow around it: scanner → evidence → fix → CI → badge → monitoring.
        </p>
        <div class="mt-8 flex flex-wrap justify-center gap-4">
          <a
            href="/agent-guide/articles/what-is-agent-readiness"
            class="pulse-glow inline-flex items-center justify-center rounded-lg bg-emerald-500 px-8 py-4 text-base font-semibold text-white transition-colors hover:bg-emerald-400"
          >
            Scan your API free
            <svg class="ml-2 h-5 w-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </a>
          <a
            href="/agent-guide/"
            class="inline-flex items-center justify-center rounded-lg border border-slate-700 bg-slate-900/50 px-8 py-4 text-base font-semibold text-slate-300 transition-colors hover:border-emerald-500 hover:text-emerald-400"
          >
            For AI agents
            <svg class="ml-2 h-5 w-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </a>
        </div>
      </div>
    </section>
  `;
}
