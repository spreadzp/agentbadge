import { html } from "hono/html";
import { APP_VERSION, GIT_COMMIT } from "../../server/lib/build-info";
import { explorerName, explorerNftUrl } from "../../server/lib/chain-ui.js";
import { DISCORD_PATH, TELEGRAM_PATH, GITHUB_PATH } from "./footer-icons";

/**
 * Shared Footer component — used by both Layout() and LandingLayout().
 * (SLICE-19-1: extracted from layout.ts for reuse)
 */
export function Footer(): ReturnType<typeof html> {
  return html`<footer class="border-t border-slate-800 bg-slate-900">
    <div class="mx-auto max-w-5xl px-4 py-8">
      <div class="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
        <div class="flex flex-col gap-3 text-sm text-slate-400">
          <div class="flex items-center gap-2">
            <picture><img src="/icons/logo-32.webp" srcset="/icons/logo-64.webp 2x" alt="" loading="eager" decoding="async" class="h-5 w-5 rounded" /></picture>
            <span>AgentBadge · Agency for the agentic web — agent-ready infrastructure on Arc (legacy: Hedera testnet)</span>
          </div>
          <a href="https://mcprush.com/spreadzp/agentbadge-mcp" target="_blank" rel="noopener" title="AgentBadge MCP — grade A on mcprush">
            <img src="https://mcprush.com/badge/agentbadge-mcp/card.svg" alt="AgentBadge MCP on mcprush — grade A" width="152" height="80" loading="lazy" decoding="async" class="h-16 w-auto rounded-lg" />
          </a>
        </div>
        <div class="flex items-center gap-4">
          <a href="/contact" class="footer-pop inline-flex min-h-6 min-w-6 items-center justify-center p-1 text-slate-400 hover:text-emerald-400" aria-label="Discord">
            <svg class="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
              <path d="${DISCORD_PATH}" />
            </svg>
          </a>
          <a href="/contact" class="footer-pop inline-flex min-h-6 min-w-6 items-center justify-center p-1 text-slate-400 hover:text-emerald-400" aria-label="Telegram">
            <svg class="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
              <path d="${TELEGRAM_PATH}" />
            </svg>
          </a>
          <a href="https://raw.githubusercontent.com/spreadzp/agentbadge/refs/heads/main/AGENT-REFERENCE.md" target="_blank" rel="noopener" class="footer-pop inline-flex min-h-6 min-w-6 items-center justify-center p-1 text-slate-400 hover:text-emerald-400" aria-label="GitHub">
            <svg class="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
              <path d="${GITHUB_PATH}" />
            </svg>
          </a>
          <a href="https://agentbadge.gitbook.io/agentbadge-docs" target="_blank" rel="noopener" class="footer-pop inline-flex min-h-6 min-w-6 items-center justify-center p-1 text-slate-400 hover:text-emerald-400" aria-label="GitBook Documentation">
            <svg class="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M19 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2zm-7 14H6V5h6v12zm7 0h-5V5h5v12z" />
            </svg>
          </a>
        </div>
      </div>
      <div class="mt-6 grid grid-cols-2 gap-x-8 gap-y-2 text-sm text-slate-400 sm:grid-cols-3 lg:grid-cols-4">
        <div class="flex flex-col gap-2">
          <span class="mb-1 text-xs font-semibold uppercase tracking-wider text-slate-500">Services</span>
          <a href="/services/scanner" class="footer-pop inline-flex items-center gap-2 py-1 hover:text-emerald-400">
            <svg class="h-4 w-4 shrink-0 text-slate-500" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" /></svg>
            Scanner
          </a>
          <a href="/services/passports" class="footer-pop inline-flex items-center gap-2 py-1 hover:text-emerald-400">
            <svg class="h-4 w-4 shrink-0 text-slate-500" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
            Passports
          </a>
          <a href="/services/marketplace" class="footer-pop inline-flex items-center gap-2 py-1 hover:text-emerald-400">
            <svg class="h-4 w-4 shrink-0 text-slate-500" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" /></svg>
            Marketplace
          </a>
        </div>
        <div class="flex flex-col gap-2">
          <span class="mb-1 text-xs font-semibold uppercase tracking-wider text-slate-500">Guides</span>
          <a href="/agent-guide" class="footer-pop inline-flex items-center gap-2 py-1 hover:text-emerald-400">
            <svg class="h-4 w-4 shrink-0 text-slate-500" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" /></svg>
            Agent Guide
          </a>
          <a href="/market-guide" class="footer-pop inline-flex items-center gap-2 py-1 hover:text-emerald-400">
            <svg class="h-4 w-4 shrink-0 text-slate-500" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" /></svg>
            Market Guide
          </a>
          <a href="/blog" class="footer-pop inline-flex items-center gap-2 py-1 hover:text-emerald-400">
            <svg class="h-4 w-4 shrink-0 text-slate-500" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 0a2 2 0 012 2v8a2 2 0 01-2 2m0-12V6m0 12V8m0 0H5" /></svg>
            Blog
          </a>
        </div>
        <div class="flex flex-col gap-2">
          <span class="mb-1 text-xs font-semibold uppercase tracking-wider text-slate-500">Product</span>
          <a href="/faq" class="footer-pop inline-flex items-center gap-2 py-1 hover:text-emerald-400">
            <svg class="h-4 w-4 shrink-0 text-slate-500" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            FAQ
          </a>
          <a href="/rules" class="footer-pop inline-flex items-center gap-2 py-1 hover:text-emerald-400">
            <svg class="h-4 w-4 shrink-0 text-slate-500" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" /></svg>
            Rules
          </a>
          <a href="/use-cases" class="footer-pop inline-flex items-center gap-2 py-1 hover:text-emerald-400">
            <svg class="h-4 w-4 shrink-0 text-slate-500" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" /></svg>
            Use Cases
          </a>
          <a href="/pricing" class="footer-pop inline-flex items-center gap-2 py-1 hover:text-emerald-400">
            <svg class="h-4 w-4 shrink-0 text-slate-500" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            Pricing
          </a>
          <a href="/changelog" class="footer-pop inline-flex items-center gap-2 py-1 hover:text-emerald-400">
            <svg class="h-4 w-4 shrink-0 text-slate-500" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            Changelog
          </a>
        </div>
        <div class="flex flex-col gap-2">
          <span class="mb-1 text-xs font-semibold uppercase tracking-wider text-slate-500">Company</span>
          <a href="/about" class="footer-pop inline-flex items-center gap-2 py-1 hover:text-emerald-400">
            <svg class="h-4 w-4 shrink-0 text-slate-500" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            About
          </a>
          <a href="/services" class="footer-pop inline-flex items-center gap-2 py-1 hover:text-emerald-400">
            <svg class="h-4 w-4 shrink-0 text-slate-500" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
            Services
          </a>
          <a href="/work-with-us" class="footer-pop inline-flex items-center gap-2 py-1 hover:text-emerald-400">
            <svg class="h-4 w-4 shrink-0 text-slate-500" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M17 20h5v-2a4 4 0 00-3-3.87M9 20H4v-2a4 4 0 013-3.87m6-1.13a4 4 0 100-8 4 4 0 000 8zm-6 0a3 3 0 100-6 3 3 0 000 6z" /></svg>
            Work With Us
          </a>
          <a href="/ui/medical-demo" class="footer-pop inline-flex items-center gap-2 py-1 hover:text-emerald-400">
            <svg class="h-4 w-4 shrink-0 text-slate-500" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
            Medical Demo
          </a>
          <a href="${explorerNftUrl(process.env.PASSPORT_TOKEN_ID ?? "0.0.9681741", "1")}" target="_blank" rel="noopener" class="footer-pop inline-flex items-center gap-2 py-1 hover:text-emerald-400">
            <svg class="h-4 w-4 shrink-0 text-slate-500" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-0L10 14" /></svg>
            ${explorerName()}
          </a>
          <a href="mailto:support@agentbadge.xyz" class="footer-pop inline-flex items-center gap-2 py-1 hover:text-emerald-400">
            <svg class="h-4 w-4 shrink-0 text-slate-500" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
            support@agentbadge.xyz
          </a>
        </div>
        <div class="flex flex-col gap-2">
          <span class="mb-1 text-xs font-semibold uppercase tracking-wider text-slate-500">Engineering</span>
          <a href="/services" class="footer-pop inline-flex items-center gap-2 py-1 hover:text-emerald-400">
            <svg class="h-4 w-4 shrink-0 text-slate-500" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
            Services
          </a>
          <a href="/work-with-us" class="footer-pop inline-flex items-center gap-2 py-1 hover:text-emerald-400">
            <svg class="h-4 w-4 shrink-0 text-slate-500" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M17 20h5v-2a4 4 0 00-3-3.87M9 20H4v-2a4 4 0 013-3.87m6-1.13a4 4 0 100-8 4 4 0 000 8zm-6 0a3 3 0 100-6 3 3 0 000 6z" /></svg>
            Work With Us
          </a>
          <a href="/about" class="footer-pop inline-flex items-center gap-2 py-1 hover:text-emerald-400">
            <svg class="h-4 w-4 shrink-0 text-slate-500" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M17 20h5v-2a4 4 0 00-3-3.87M9 20H4v-2a4 4 0 013-3.87m6-1.13a4 4 0 100-8 4 4 0 000 8zm-6 0a3 3 0 100-6 3 3 0 000 6z" /></svg>
            Team
          </a>
          <a href="/about" class="footer-pop inline-flex items-center gap-2 py-1 hover:text-emerald-400">
            <svg class="h-4 w-4 shrink-0 text-slate-500" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            About
          </a>
        </div>
        <div class="flex flex-col gap-2">
          <span class="mb-1 text-xs font-semibold uppercase tracking-wider text-slate-500">Legal</span>
          <a href="/terms" class="footer-pop inline-flex items-center gap-2 py-1 hover:text-emerald-400">
            <svg class="h-4 w-4 shrink-0 text-slate-500" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
            Terms
          </a>
          <a href="/privacy" class="footer-pop inline-flex items-center gap-2 py-1 hover:text-emerald-400">
            <svg class="h-4 w-4 shrink-0 text-slate-500" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
            Privacy
          </a>
        </div>
      </div>
    </div>
    <div class="border-t border-slate-800 py-4 text-center text-xs text-slate-400">
      © 2026 AgentBadge. MIT License. Built on Arc.
      <span class="ml-2 text-slate-500">v${APP_VERSION} · ${GIT_COMMIT.slice(0, 7)}</span>
      <span class="mt-3 flex flex-wrap items-center justify-center gap-2">
        <a href="https://www.npmjs.com/package/@agentbadge/mcp" target="_blank" rel="noopener" title="@agentbadge/mcp on npm">
          <img src="https://img.shields.io/npm/v/@agentbadge/mcp?style=flat-square&label=npm&color=334155" alt="npm version" loading="lazy" decoding="async" class="h-5 w-auto" />
        </a>
        <a href="https://saasbrowser.com/en/saas/1618369/agentbadge" target="_blank" rel="noopener" title="Verified on SaaS Browser">
          <img src="https://files.saasbrowser.com/h05pfd6qctu4jsnymq6q06maaf2t" alt="Verified on SaaS Browser" loading="lazy" decoding="async" class="h-5 w-auto" />
        </a>
        <a href="https://hol.org/registry/plugins/agentbadge%2Fagentbadge-mcp" target="_blank" rel="noopener" title="Owner-verified on HOL Registry (trust 77)">
          <img src="https://img.shields.io/badge/HOL%20Registry-owner--verified%20%C2%B7%20trust%2077-334155?style=flat-square" alt="HOL Registry: owner-verified, trust 77" loading="lazy" decoding="async" class="h-5 w-auto" />
        </a>
        <a href="https://mcprush.com/spreadzp/agentbadge-mcp" target="_blank" rel="noopener" title="mcprush grade A, trust 95/100">
          <img src="https://img.shields.io/badge/mcprush-A%20%C2%B7%2095%2F100-334155?style=flat-square" alt="mcprush grade A, trust 95/100" loading="lazy" decoding="async" class="h-5 w-auto" />
        </a>
        <a href="https://viberank.dev/apps/AgentBadge" target="_blank" rel="noopener" title="AgentBadge on VibeRank — community leaderboard">
          <img src="https://viberank.dev/badge?app=AgentBadge&amp;theme=dark" alt="AgentBadge on VibeRank" loading="lazy" decoding="async" class="h-5 w-auto" />
        </a>
        <a href="/.well-known/x402-payto.json" target="_blank" rel="noopener" title="x402 payout proof: payTo wallet signs EIP-191; DNS TXT _x402-payto.agentbadge.xyz">
          <img src="https://img.shields.io/badge/x402%20payto-proof%20signed-334155?style=flat-square" alt="x402 payout proof signed" loading="lazy" decoding="async" class="h-5 w-auto" />
        </a>
      </span>
    </div>
  </footer>`;
}
