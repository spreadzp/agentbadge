// EPIC-140 (SLICE-140-20): service page — assembled from sections.
import { html, raw } from "hono/html";
import type { AgencyService } from "../../server/lib/agency-config";
import { RelatedLinks } from "../related-links";
import { expandAbbr, getServiceCrossLinks } from "./utils";
import { ServiceHero } from "./hero";
import { ServiceCta, HowItWorksSection, UseCasesSection, FaqSection, PricingSection } from "./sections";

export function ServicePageView(service: AgencyService, otherServices: AgencyService[]) {
  const featuresList = service.features
    .map(
      (f) =>
        `<li class="flex items-start gap-3 text-slate-300"><span class="text-emerald-400 mt-1">✓</span> ${expandAbbr(f)}</li>`,
    )
    .join("");

  const otherLinks = otherServices
    .filter((s) => s.id !== service.id)
    .map(
      (s) =>
        `<a href="${s.url}" class="block rounded-lg border border-slate-700 bg-slate-900/50 p-4 transition-all hover:border-emerald-500">
          <div class="text-2xl mb-1">${s.icon}</div>
          <div class="text-sm font-semibold text-white">${s.name}</div>
          <div class="text-xs text-slate-400 mt-1">${expandAbbr(s.tagline)}</div>
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
    ${raw(HowItWorksSection(service).toString())}
    ${raw(UseCasesSection(service).toString())}
    ${raw(FaqSection(service).toString())}
    ${raw(PricingSection(service).toString())}
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
    ${raw(RelatedLinks("Explore More", getServiceCrossLinks(service.id)))}
  </div>`;
}
