import { html, raw } from "hono/html";
import type { AgencyService } from "../server/lib/agency-config";

/**
 * ServicePageView — reusable landing page template for agency services.
 * SLICE-51-3, 51-4, 51-5
 *
 * Renders: hero, features, CTA, cross-links to other services.
 */
export function ServicePageView(service: AgencyService, otherServices: AgencyService[]) {
  const featuresList = service.features
    .map(
      (f) =>
        `<li class="flex items-start gap-3 text-slate-300"><span class="text-emerald-400 mt-1">✓</span> ${f}</li>`,
    )
    .join("");

  const otherLinks = otherServices
    .filter((s) => s.id !== service.id)
    .map(
      (s) =>
        `<a href="${s.url}" class="block rounded-lg border border-slate-700 bg-slate-900/50 p-4 transition-all hover:border-emerald-500">
          <div class="text-2xl mb-1">${s.icon}</div>
          <div class="text-sm font-semibold text-white">${s.name}</div>
          <div class="text-xs text-slate-400 mt-1">${s.tagline}</div>
        </a>`,
    )
    .join("");

  return html`<div class="service-page">
    ${raw(`<nav class="px-4 py-3 text-sm text-slate-400 md:px-8" aria-label="Breadcrumb">
      <ol class="flex items-center gap-2">
        <li><a href="/" class="hover:text-emerald-400">Home</a></li>
        <li class="text-slate-600">/</li>
        <li><a href="/services" class="hover:text-emerald-400">Services</a></li>
        <li class="text-slate-600">/</li>
        <li class="text-slate-300">${service.name}</li>
      </ol>
    </nav>`)}
    ${raw(ServiceHero(service).toString())}
    ${raw(`<section class="px-4 py-16 md:px-8">
      <div class="mx-auto max-w-4xl">
        <h2 class="text-2xl font-bold text-white">What you get</h2>
        <ul class="mt-6 space-y-3">
          ${raw(featuresList)}
        </ul>
      </div>
    </section>`)}
    ${raw(ServiceCta(service).toString())}
    ${raw(`<section class="px-4 py-16 md:px-8 bg-slate-900/30">
      <div class="mx-auto max-w-5xl">
        <h2 class="text-2xl font-bold text-white text-center">Other services</h2>
        <div class="mt-8 grid gap-4 md:grid-cols-2">
          ${raw(otherLinks)}
        </div>
        <div class="mt-8 text-center">
          <a href="/" class="text-sm text-emerald-400 hover:text-emerald-300">← Back to AgentBadge</a>
        </div>
      </div>
    </section>`)}
  </div>`;
}

function ServiceHero(service: AgencyService) {
  const ctaHref = getCtaHref(service.id);
  const ctaLabel = getCtaLabel(service.id);

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
          ${service.tagline}
        </p>
        <p class="fade-in-up mt-6 text-lg text-slate-400 max-w-2xl" style="animation-delay: 0.2s">
          ${service.description}
        </p>
        <div class="fade-in-up mt-8 flex flex-wrap gap-4" style="animation-delay: 0.3s">
          <a href="${ctaHref}" class="pulse-glow inline-flex items-center justify-center rounded-lg bg-emerald-500 px-8 py-4 text-base font-semibold text-white transition-colors hover:bg-emerald-400">
            ${ctaLabel}
            <svg class="ml-2 h-5 w-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </a>
          <a href="/" class="inline-flex items-center justify-center rounded-lg border border-slate-700 bg-slate-900/50 px-8 py-4 text-base font-semibold text-slate-300 transition-colors hover:border-emerald-500 hover:text-emerald-400">
            Back to AgentBadge
          </a>
        </div>
      </div>
    </section>
  `;
}

function ServiceCta(service: AgencyService) {
  const ctaHref = getCtaHref(service.id);
  const ctaLabel = getCtaLabel(service.id);

  return html`
    <section class="px-4 py-16 md:px-8">
      <div class="mx-auto max-w-3xl text-center rounded-xl border border-slate-700 bg-slate-900/50 p-10">
        <h2 class="text-2xl font-bold text-white">Ready to get started?</h2>
        <p class="mt-4 text-slate-400">${service.tagline}</p>
        <div class="mt-6">
          <a href="${ctaHref}" class="inline-flex items-center justify-center rounded-lg bg-emerald-500 px-8 py-4 text-base font-semibold text-white transition-colors hover:bg-emerald-400">
            ${ctaLabel}
          </a>
        </div>
      </div>
    </section>
  `;
}

function getCtaHref(id: string): string {
  switch (id) {
    case "scanner":
      return "/dashboard";
    case "passports":
      return "/passport";
    case "marketplace":
      return "/ui/market/tasks";
    default:
      return "/";
  }
}

function getCtaLabel(id: string): string {
  switch (id) {
    case "scanner":
      return "Run a scan";
    case "passports":
      return "Get a passport";
    case "marketplace":
      return "Browse tasks";
    default:
      return "Get started";
  }
}
