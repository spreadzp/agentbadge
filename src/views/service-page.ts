import { html, raw } from "hono/html";
import type { AgencyService } from "../server/lib/agency-config";

/**
 * ServicePageView — reusable landing page template for agency services.
 * SLICE-51-3, 51-4, 51-5
 *
 * Renders: hero, features, CTA, cross-links to other services.
 */
const expandAbbr = (text: string) =>
  text
    .replace(/HCS directory/g, '<abbr title="Hedera Consensus Service">HCS</abbr> directory')
    .replace(/HCS/g, '<abbr title="Hedera Consensus Service">HCS</abbr>')
    .replace(/\bDID\b/g, '<abbr title="Decentralized Identifier">DID</abbr>')
    .replace(/\bHTS\b/g, '<abbr title="Hedera Token Service">HTS</abbr>')
    .replace(/\bAEO\b/g, '<abbr title="Answer Engine Optimization">AEO</abbr>')
    .replace(/\bGEO\b/g, '<abbr title="Generative Engine Optimization">GEO</abbr>');

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
  </div>`;
}

function ServiceHero(service: AgencyService) {
  const ctaHref = getCtaHref(service.id);
  const ctaLabel = getCtaLabel(service.id);
  const isScanner = service.id === "scanner";

  const scannerCta = html`<button id="scanner-cta-btn" type="button" class="snake-border inline-flex items-center justify-center rounded-lg border border-slate-700 bg-slate-900/50 px-8 py-4 text-base font-semibold text-slate-300 transition-colors hover:border-emerald-500 hover:text-emerald-400" onclick="document.getElementById('scan-form-wrapper').classList.remove('hidden'); document.getElementById('scanner-cta-btn').classList.add('hidden'); document.getElementById('total-scan-url').focus();">
            ${ctaLabel}
            <svg class="ml-2 h-5 w-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </button>
          <div id="scan-form-wrapper" class="hidden fade-in-up mt-2">
            <form id="total-scan-form" class="flex flex-col gap-3 sm:flex-row">
              <input
                id="total-scan-url"
                type="url"
                placeholder="https://example.com"
                required
                class="flex-1 rounded-lg border border-slate-700 bg-slate-900 px-4 py-3 text-sm text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
              />
              <button
                id="total-scan-submit"
                type="submit"
                class="snake-border inline-flex items-center justify-center rounded-lg border border-slate-700 bg-slate-900/50 px-6 py-3 text-sm font-semibold text-slate-300 transition-colors hover:border-emerald-500 hover:text-emerald-400"
              >
                Start Full Scan
              </button>
            </form>
            <button
              type="button"
              class="mt-2 text-xs text-slate-500 hover:text-slate-300"
              onclick="document.getElementById('scan-form-wrapper').classList.add('hidden'); document.getElementById('scanner-cta-btn').classList.remove('hidden');"
            >
              Cancel
            </button>
            <div id="total-scan-result" class="mt-6 hidden"></div>
          </div>
          <script>
          (function() {
            var form = document.getElementById('total-scan-form');
            var result = document.getElementById('total-scan-result');
            var submitBtn = document.getElementById('total-scan-submit');
            if (!form) return;

            form.addEventListener('submit', async function(e) {
              e.preventDefault();
              var url = document.getElementById('total-scan-url').value.trim();
              if (!url) return;

              submitBtn.disabled = true;
              submitBtn.textContent = 'Scanning...';
              submitBtn.classList.add('snake-scanning');
              result.classList.remove('hidden');
              result.innerHTML = '<div class="text-slate-400 text-sm">Starting scan for ' + url + '...</div>';

              try {
                var response = await fetch('/api/total-scan', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ url: url })
                });

                var reader = response.body.getReader();
                var decoder = new TextDecoder();
                var buffer = '';

                while (true) {
                  var chunk = await reader.read();
                  if (chunk.done) break;
                  buffer += decoder.decode(chunk.value, { stream: true });

                  var lines = buffer.split('\\n');
                  buffer = lines.pop() || '';

                  for (var i = 0; i < lines.length; i++) {
                    var line = lines[i];
                    if (line.startsWith('data: ')) {
                      var data = JSON.parse(line.slice(6));
                      if (data.phase === 'fetching') {
                        var pct = data.total > 0 ? Math.round((data.completed / data.total) * 100) : 0;
                        result.innerHTML = '<div class="space-y-2">'
                          + '<div class="flex items-center justify-between text-sm">'
                          + '<span class="text-slate-300">Fetching resources</span>'
                          + '<span class="text-slate-500">' + pct + '%</span>'
                          + '</div>'
                          + '<div class="h-2 w-full rounded-full bg-slate-800">'
                          + '<div class="h-2 rounded-full bg-indigo-500 transition-all duration-300" style="width:' + pct + '%"></div>'
                          + '</div>'
                          + '<div class="text-xs text-slate-500">Fetching: ' + data.resource + '</div>'
                          + '</div>';
                      } else if (data.phase === 'evaluating') {
                        var pct = data.total > 0 ? Math.round((data.completed / data.total) * 100) : 0;
                        result.innerHTML = '<div class="space-y-2">'
                          + '<div class="flex items-center justify-between text-sm">'
                          + '<span class="text-slate-300">Evaluating rules</span>'
                          + '<span class="text-slate-500">' + pct + '%</span>'
                          + '</div>'
                          + '<div class="h-2 w-full rounded-full bg-slate-800">'
                          + '<div class="h-2 rounded-full bg-emerald-500 transition-all duration-300" style="width:' + pct + '%"></div>'
                          + '</div>'
                          + '</div>';
                      } else if (data.score !== undefined) {
                        renderReport(result, data);
                      }
                    }
                  }
                }
              } catch (err) {
                result.innerHTML = '<div class="text-rose-300 text-sm">Error: ' + err.message + '</div>';
              } finally {
                submitBtn.disabled = false;
                submitBtn.textContent = 'Start Full Scan';
                submitBtn.classList.remove('snake-scanning');
              }
            });

            function renderReport(container, report) {
              var scoreColor = report.score >= 80 ? 'text-emerald-400' : report.score >= 50 ? 'text-amber-400' : 'text-rose-400';
              var html = '<div class="space-y-6">';

              html += '<div class="flex items-center gap-6">';
              html += '<div class="text-5xl font-bold ' + scoreColor + '">' + report.score + '</div>';
              html += '<div>';
              html += '<div class="text-2xl font-semibold text-white">Grade: ' + report.grade + '</div>';
              html += '<div class="text-slate-400 text-sm">' + report.summary + '</div>';
              html += '</div></div>';

              html += '<div class="rounded-lg border border-slate-700 overflow-hidden">';
              html += '<div class="bg-slate-800 px-4 py-2 text-sm font-semibold text-slate-300">Category Breakdown</div>';
              html += '<div class="divide-y divide-slate-800">';
              for (var i = 0; i < report.categories.length; i++) {
                var cat = report.categories[i];
                var pct = cat.completeness_pct;
                var barColor = pct >= 80 ? 'bg-emerald-500' : pct >= 50 ? 'bg-amber-500' : 'bg-rose-500';
                html += '<div class="px-4 py-3 flex items-center gap-4">';
                html += '<span class="text-lg">' + cat.icon + '</span>';
                html += '<div class="flex-1">';
                html += '<div class="text-sm text-slate-300">' + cat.name + '</div>';
                html += '<div class="mt-1 h-1.5 w-full rounded-full bg-slate-800">';
                html += '<div class="h-1.5 rounded-full ' + barColor + '" style="width:' + pct + '%"></div>';
                html += '</div></div>';
                html += '<div class="text-xs text-slate-500">' + cat.verified + '/' + cat.total + '</div>';
                html += '</div>';
              }
              html += '</div></div>';

              if (report.top_missing && report.top_missing.length > 0) {
                html += '<div class="rounded-lg border border-slate-700 overflow-hidden">';
                html += '<div class="bg-slate-800 px-4 py-2 text-sm font-semibold text-slate-300">Top Issues to Fix</div>';
                html += '<div class="divide-y divide-slate-800">';
                for (var j = 0; j < report.top_missing.length; j++) {
                  var rule = report.top_missing[j];
                  html += '<div class="px-4 py-3">';
                  html += '<div class="flex items-center justify-between">';
                  html += '<span class="text-sm text-slate-300">' + rule.title + '</span>';
                  html += '<span class="text-xs text-slate-500">' + rule.estimated_cost + '</span>';
                  html += '</div>';
                  html += '<div class="text-xs text-slate-500 mt-1">' + rule.hint + '</div>';
                  html += '</div>';
                }
                html += '</div></div>';
              }

              html += '</div>';
              container.innerHTML = html;
            }
          })();
          </script>`;

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

function ServiceCta(service: AgencyService) {
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

function HowItWorksSection(service: AgencyService) {
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

function UseCasesSection(service: AgencyService) {
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

function FaqSection(service: AgencyService) {
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

function PricingSection(service: AgencyService) {
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
