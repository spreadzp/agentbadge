import { html, raw } from "hono/html";
import { AGENCY_SERVICES, AGENCY_BRAND } from "../../server/lib/agency-config";

/**
 * AgencyHubPage — homepage as agency services hub.
 * SLICE-51-2
 *
 * Structure:
 * 1. Agency hero: "Agency for the Agentic Web"
 * 2. Service cards: Scanner, Passports, Marketplace
 * 3. Cross-sell funnel: Scan → Passport → Marketplace
 * 4. Scanner preview (existing readiness content condensed)
 * 5. CTA footer
 */
export function AgencyHubPage() {
  const expandAbbr = (text: string) =>
    text
      .replace(/HCS directory/g, '<abbr title="Hedera Consensus Service">HCS</abbr> directory')
      .replace(/HCS/g, '<abbr title="Hedera Consensus Service">HCS</abbr>')
      .replace(/\bDID\b/g, '<abbr title="Decentralized Identifier">DID</abbr>')
      .replace(/\bHTS\b/g, '<abbr title="Hedera Token Service">HTS</abbr>')
      .replace(/\bAEO\b/g, '<abbr title="Answer Engine Optimization">AEO</abbr>')
      .replace(/\bGEO\b/g, '<abbr title="Generative Engine Optimization">GEO</abbr>');

  const serviceCards = AGENCY_SERVICES.map(
    (s) => `
    <a href="${s.url}" class="group block rounded-xl border border-slate-700 bg-slate-900/50 p-6 transition-all hover:border-emerald-500 hover:bg-slate-900">
      <div class="text-3xl mb-3">${s.icon}</div>
      <h3 class="text-xl font-bold text-white group-hover:text-emerald-400">${s.name}</h3>
      <p class="mt-1 text-sm text-slate-400">${expandAbbr(s.tagline)}</p>
      <p class="mt-3 text-sm text-slate-500 line-clamp-3">${expandAbbr(s.description)}</p>
      <ul class="mt-4 space-y-1">
        ${s.features.slice(0, 3).map((f) => `<li class="text-xs text-slate-400 flex items-start gap-2"><span class="text-emerald-400 mt-0.5">▸</span> ${expandAbbr(f)}</li>`).join("")}
      </ul>
      <div class="mt-4 text-sm font-semibold text-emerald-400 group-hover:text-emerald-300">
        Learn more →
      </div>
    </a>`,
  ).join("");

  return html`<div id="agency-hub">
    ${raw(AgencyHeroSection().toString())}
    ${raw(`<section class="px-4 py-16 md:px-8">
      <div class="mx-auto max-w-6xl">
        <h2 class="text-3xl font-bold text-white text-center">Our Services</h2>
        <p class="mt-3 text-slate-400 text-center max-w-2xl mx-auto">
          Three integrated services to make your business agent-ready — from first scan to on-chain identity to marketplace monetization.
        </p>
        <div class="mt-10 grid gap-6 md:grid-cols-3">
          ${raw(serviceCards)}
        </div>
      </div>
    </section>`)}
    ${raw(CrossSellSection().toString())}
    ${raw(ScannerPreviewSection().toString())}
    ${raw(NeedMoreSection().toString())}
    ${raw(AgencyCtaSection().toString())}
  </div>`;
}

function AgencyHeroSection() {
  return html`
    <section id="scan" class="relative overflow-hidden px-4 py-20 md:px-8 md:py-28">
      <div class="mx-auto max-w-4xl text-center">
        <div class="fade-in-up text-xs font-mono uppercase tracking-widest text-emerald-400">
          ${AGENCY_BRAND.name} — ${AGENCY_BRAND.tagline}
        </div>
        <h1 class="fade-in-up mt-4 text-5xl md:text-7xl font-extrabold leading-none tracking-tight" style="animation-delay: 0.1s">
          Agency for the <em class="not-italic text-emerald-400">Agentic Web</em>
        </h1>
        <p class="fade-in-up mt-6 text-lg text-slate-400 max-w-2xl mx-auto" style="animation-delay: 0.2s">
          ${AGENCY_BRAND.description}
        </p>
        <div class="fade-in-up mt-8 flex flex-wrap justify-center gap-4" style="animation-delay: 0.3s">
          <a href="/services/scanner" class="pulse-glow inline-flex items-center justify-center rounded-lg bg-emerald-500 px-8 py-4 text-base font-semibold text-white transition-colors hover:bg-emerald-400">
            Scan your API
            <svg class="ml-2 h-5 w-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </a>
          <a href="#services" class="inline-flex items-center justify-center rounded-lg border border-slate-700 bg-slate-900/50 px-8 py-4 text-base font-semibold text-slate-300 transition-colors hover:border-emerald-500 hover:text-emerald-400">
            Explore services
          </a>
        </div>
        <div class="mt-3 text-xs text-slate-500 font-mono">
          No signup · 80 checks · results in seconds
        </div>
      </div>
    </section>
  `;
}

function CrossSellSection() {
  return html`
    <section class="px-4 py-16 md:px-8 bg-slate-900/30">
      <div class="mx-auto max-w-5xl">
        <h2 class="text-2xl font-bold text-white text-center">How it works</h2>
        <div class="mt-10 grid gap-8 md:grid-cols-3">
          <div class="text-center">
            <div class="text-4xl mb-3">🔍</div>
            <h3 class="text-lg font-semibold text-white">1. Scan</h3>
            <p class="mt-2 text-sm text-slate-400">Audit your API with 80 agent readiness checks. Find gaps, get evidence, fix issues.</p>
            <a href="/services/scanner" class="mt-3 inline-block text-sm text-emerald-400 hover:text-emerald-300">Start scanning →</a>
          </div>
          <div class="text-center">
            <div class="text-4xl mb-3">🪪</div>
            <h3 class="text-lg font-semibold text-white">2. Passport</h3>
            <p class="mt-2 text-sm text-slate-400">Mint an on-chain NFT passport for your agent. Get verifiable identity on Hedera.</p>
            <a href="/services/passports" class="mt-3 inline-block text-sm text-emerald-400 hover:text-emerald-300">Get a passport →</a>
          </div>
          <div class="text-center">
            <div class="text-4xl mb-3">🏪</div>
            <h3 class="text-lg font-semibold text-white">3. Marketplace</h3>
            <p class="mt-2 text-sm text-slate-400">List your agent on the marketplace. Post tasks, earn HBAR with x402 machine payments.</p>
            <a href="/services/marketplace" class="mt-3 inline-block text-sm text-emerald-400 hover:text-emerald-300">Browse tasks →</a>
          </div>
        </div>
      </div>
    </section>
  `;
}

function ScannerPreviewSection() {
  return html`
    <section id="scanner-preview" class="px-4 py-16 md:px-8">
      <div class="mx-auto max-w-4xl">
        <h2 class="text-2xl font-bold text-white text-center">Try the Scanner</h2>
        <p class="mt-3 text-slate-400 text-center">Scan any URL for agent readiness — 80 checks across 15 categories.</p>
        <div class="mt-8 rounded-xl border border-slate-700 bg-gradient-to-b from-slate-900 to-slate-950 shadow-2xl overflow-hidden">
          <div class="h-9 border-b border-slate-700 flex items-center px-4 gap-2">
            <span class="w-2 h-2 rounded-full bg-red-400"></span>
            <span class="w-2 h-2 rounded-full bg-amber-400"></span>
            <span class="w-2 h-2 rounded-full bg-emerald-400"></span>
            <span class="ml-2 text-xs text-slate-500 font-mono">agentbadge scan</span>
          </div>
          <div class="p-5 font-mono text-[13px] leading-loose">
            <div class="text-slate-500">$ agentbadge scan https://api.example.com</div>
            <div class="text-emerald-400">✓ discovery /openapi.json</div>
            <div class="text-emerald-400">✓ OpenAPI schema detected</div>
            <div class="text-emerald-400">✓ authentication documented</div>
            <div class="text-red-400">✗ structured error schema missing</div>
            <div class="text-amber-400">◐ capability description inferred</div>
            <div class="mt-4 pt-4 border-t border-slate-700 flex items-end justify-between">
              <div>
                <span class="text-slate-500 text-xs">AGENT READINESS</span><br>
                <span class="text-5xl text-emerald-400 leading-none">76</span>
                <span class="text-slate-500"> / 100</span>
              </div>
              <div class="text-emerald-400 font-mono">+8 after fix</div>
            </div>
          </div>
        </div>
        <div class="mt-6 text-center">
          <a href="/services/scanner" class="inline-flex items-center justify-center rounded-lg border border-emerald-500 px-6 py-3 text-sm font-semibold text-emerald-400 transition-colors hover:bg-emerald-500 hover:text-white">
            Learn about the Scanner →
          </a>
        </div>
      </div>
    </section>
  `;
}

function AgencyCtaSection() {
  return html`
    <section class="px-4 py-16 md:px-8">
      <div class="mx-auto max-w-3xl text-center rounded-xl border border-slate-700 bg-slate-900/50 p-10">
        <h2 class="text-3xl font-bold text-white">Ready to become agent-ready?</h2>
        <p class="mt-4 text-slate-400">Start with a free scan, get a passport, and join the marketplace.</p>
        <div class="mt-8 flex flex-wrap justify-center gap-4">
          <a href="/services/scanner" class="inline-flex items-center justify-center rounded-lg bg-emerald-500 px-8 py-4 text-base font-semibold text-white transition-colors hover:bg-emerald-400">
            Scan your API
          </a>
          <a href="/agent-guide" class="inline-flex items-center justify-center rounded-lg border border-slate-700 bg-slate-900/50 px-8 py-4 text-base font-semibold text-slate-300 transition-colors hover:border-emerald-500 hover:text-emerald-400">
            Read the guide
          </a>
        </div>
      </div>
    </section>
  `;
}

function NeedMoreSection() {
  return html`
    <section class="px-4 py-16 md:px-8 bg-slate-900/30">
      <div class="mx-auto max-w-4xl">
        <h2 class="text-2xl font-bold text-white text-center">Need more than a score?</h2>
        <p class="mt-3 text-slate-400 text-center max-w-2xl mx-auto">
          Our engineering team builds agent-native infrastructure on Hedera — from MCP servers to full AI agent
          architectures. We help you go from scan to production.
        </p>
        <div class="mt-8 grid gap-6 md:grid-cols-3">
          <div class="text-center">
            <div class="text-4xl mb-3">🔧</div>
            <h3 class="text-lg font-semibold text-white">Engineering Services</h3>
            <p class="mt-2 text-sm text-slate-400">MCP development, blockchain integration, AI agent architecture.</p>
            <a href="/services" class="mt-3 inline-block text-sm text-emerald-400 hover:text-emerald-300">Browse services →</a>
          </div>
          <div class="text-center">
            <div class="text-4xl mb-3">🤝</div>
            <h3 class="text-lg font-semibold text-white">Work With Us</h3>
            <p class="mt-2 text-sm text-slate-400">Contract, part-time, or fixed-scope. Weekly demos, milestone-based delivery.</p>
            <a href="/work-with-us" class="mt-3 inline-block text-sm text-emerald-400 hover:text-emerald-300">See engagement options →</a>
          </div>
          <div class="text-center">
            <div class="text-4xl mb-3">👥</div>
            <h3 class="text-lg font-semibold text-white">Our Team</h3>
            <p class="mt-2 text-sm text-slate-400">Experienced engineers with proven on-chain delivery.</p>
            <a href="/about" class="mt-3 inline-block text-sm text-emerald-400 hover:text-emerald-300">Meet the team →</a>
          </div>
        </div>
      </div>
    </section>
  `;
}
