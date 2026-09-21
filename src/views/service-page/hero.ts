// EPIC-140 (SLICE-140-20): service hero section.
import { html, raw } from "hono/html";
import type { AgencyService } from "../../server/lib/agency-config";
import { expandAbbr, getCtaHref, getCtaLabel } from "./utils";
import { ScannerCta } from "./scanner-cta";

export function ServiceHero(service: AgencyService) {
  const ctaHref = getCtaHref(service.id);
  const ctaLabel = getCtaLabel(service.id);
  const isScanner = service.id === "scanner";

  const scannerCta = ScannerCta(ctaLabel);

  const defaultCta = html`<a href="${ctaHref}" class="inline-flex items-center justify-center rounded-lg bg-emerald-500 px-8 py-4 text-base font-semibold text-white transition-colors hover:bg-emerald-400">
            ${ctaLabel}
            <svg class="ml-2 h-5 w-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </a>`;

  return html`
    <section class="relative overflow-hidden px-4 py-20 md:px-8 md:py-28">
      <div class="mx-auto max-w-4xl">
        <div class="fade-in-up text-xs font-mono uppercase tracking-widest text-emerald-400">
          AgentBadge — Agency for the Agentic Web
        </div>
        <div class="mt-4 text-5xl">${service.icon}</div>
        <h1 class="fade-in-up mt-4 text-4xl md:text-6xl font-extrabold leading-tight tracking-tight text-white" style="animation-delay: 0.1s">
          ${service.name}
        </h1>
        <p class="fade-in-up mt-4 text-xl text-emerald-400 font-semibold" style="animation-delay: 0.15s">
          ${raw(expandAbbr(service.tagline))}
        </p>
        <p class="fade-in-up mt-6 text-lg text-slate-400 max-w-2xl" style="animation-delay: 0.2s">
          ${raw(expandAbbr(service.description))}
        </p>
        <div class="fade-in-up mt-8 flex flex-wrap items-start gap-4" style="animation-delay: 0.3s">
          ${isScanner ? raw(scannerCta.toString()) : raw(defaultCta.toString())}
          <a href="/" class="inline-flex items-center justify-center rounded-lg border border-slate-700 bg-slate-900/50 px-8 py-4 text-base font-semibold text-slate-300 transition-colors hover:border-emerald-500 hover:text-emerald-400">
            Back to AgentBadge
          </a>
        </div>
      </div>
    </section>
  `;
}
