// EPIC-140 (SLICE-140-20): service page sections (CTA, how-it-works, use-cases, FAQ, pricing).
import { html, raw } from "hono/html";
import type { AgencyService } from "../../server/lib/agency-config";
import { expandAbbr, getCtaHref, getCtaLabel } from "./utils";

export function ServiceCta(service: AgencyService) {
  const ctaHref = getCtaHref(service.id);
  const ctaLabel = getCtaLabel(service.id);
  const isScanner = service.id === "scanner";

  const scannerCtaBtn = html`<button type="button" class="inline-flex items-center justify-center rounded-lg bg-emerald-500 px-8 py-4 text-base font-semibold text-white transition-colors hover:bg-emerald-400" onclick="document.getElementById('scanner-cta-btn').scrollIntoView({behavior:'smooth'}); document.getElementById('scanner-cta-btn').click();">
            ${ctaLabel}
            <svg class="ml-2 h-5 w-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </button>`;

  const defaultCtaBtn = html`<a href="${ctaHref}" class="inline-flex items-center justify-center rounded-lg bg-emerald-500 px-8 py-4 text-base font-semibold text-white transition-colors hover:bg-emerald-400">
            ${ctaLabel}
          </a>`;

  return html`
    <section class="px-4 py-16 md:px-8">
      <div class="mx-auto max-w-3xl text-center rounded-xl border border-slate-700 bg-slate-900/50 p-10">
        <h2 class="text-2xl font-bold text-white">Ready to get started?</h2>
        <p class="mt-4 text-slate-400">${raw(expandAbbr(service.tagline))}</p>
        <div class="mt-6">
          ${isScanner ? raw(scannerCtaBtn.toString()) : raw(defaultCtaBtn.toString())}
        </div>
      </div>
    </section>
  `;
}

export function HowItWorksSection(service: AgencyService) {
  if (!service.howItWorks?.length) return html``;
  const steps = service.howItWorks
    .map(
      (s, i) =>
        `<div class="mt-6">
          <h3 class="text-lg font-semibold text-emerald-400">${i + 1}. ${expandAbbr(s.step)}</h3>
          <p class="mt-2 text-sm text-slate-300">${expandAbbr(s.description)}</p>
        </div>`,
    )
    .join("");
  return html`<section class="px-4 py-16 md:px-8 bg-slate-900/30">
    <div class="mx-auto max-w-4xl">
      <h2 class="text-2xl font-bold text-white">How it works</h2>
      ${raw(steps)}
    </div>
  </section>`;
}

export function UseCasesSection(service: AgencyService) {
  if (!service.useCases?.length) return html``;
  const cards = service.useCases
    .map(
      (uc) =>
        `<div class="rounded-lg border border-slate-700 bg-slate-900/50 p-6">
          <h3 class="text-lg font-semibold text-emerald-400">${expandAbbr(uc.title)}</h3>
          <p class="mt-2 text-sm text-slate-300">${expandAbbr(uc.description)}</p>
        </div>`,
    )
    .join("");
  return html`<section class="px-4 py-16 md:px-8">
    <div class="mx-auto max-w-4xl">
      <h2 class="text-2xl font-bold text-white">Use cases</h2>
      <div class="mt-6 grid gap-4 md:grid-cols-3">
        ${raw(cards)}
      </div>
    </div>
  </section>`;
}

export function FaqSection(service: AgencyService) {
  if (!service.faq?.length) return html``;
  const items = service.faq
    .map(
      (f) =>
        `<div class="mt-6">
          <h3 class="text-lg font-semibold text-slate-200">${expandAbbr(f.question)}</h3>
          <p class="mt-2 text-sm text-slate-400">${expandAbbr(f.answer)}</p>
        </div>`,
    )
    .join("");
  return html`<section class="px-4 py-16 md:px-8 bg-slate-900/30">
    <div class="mx-auto max-w-4xl">
      <h2 class="text-2xl font-bold text-white">FAQ</h2>
      ${raw(items)}
    </div>
  </section>`;
}

export function PricingSection(service: AgencyService) {
  if (!service.pricing?.length) return html``;
  const tiers = service.pricing
    .map(
      (p) =>
        `<div class="rounded-lg border border-slate-700 bg-slate-900/50 p-6">
          <h3 class="text-lg font-semibold text-emerald-400">${p.tier}</h3>
          <div class="mt-2 text-3xl font-bold text-white">${p.price}</div>
          <ul class="mt-4 space-y-2">
            ${p.features.map((f) => `<li class="text-sm text-slate-300 flex items-start gap-2"><span class="text-emerald-400">✓</span> ${f}</li>`).join("")}
          </ul>
        </div>`,
    )
    .join("");
  return html`<section class="px-4 py-16 md:px-8">
    <div class="mx-auto max-w-4xl">
      <h2 class="text-2xl font-bold text-white">Pricing</h2>
      <div class="mt-6 grid gap-4 md:grid-cols-3">
        ${raw(tiers)}
      </div>
    </div>
  </section>`;
}
