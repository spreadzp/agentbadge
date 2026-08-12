import { html, raw } from "hono/html";

/**
 * Shared Footer component — used by both Layout() and LandingLayout().
 * (SLICE-19-1: extracted from layout.ts for reuse)
 */
export function Footer(): ReturnType<typeof html> {
  return html`<footer class="border-t border-slate-800 bg-slate-900">
    <div class="mx-auto max-w-5xl px-4 py-8">
      <div class="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
        <div class="flex items-center gap-2 text-sm text-slate-400">
          <picture><img src="/icons/logo-32.webp" srcset="/icons/logo-64.webp 2x" alt="" class="h-5 w-5 rounded" /></picture>
          <span>AgentBadge · Agency for the agentic web — agent-ready infrastructure on Hedera</span>
        </div>
        <div class="flex items-center gap-4">
          <a href="/contact" class="footer-pop inline-flex min-h-6 min-w-6 items-center justify-center p-1 text-slate-400 hover:text-emerald-400" aria-label="Discord">
            <svg class="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M20.317 4.37a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.872-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.094.252-.192.372-.291a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.009c.12.099.246.198.373.292a.077.077 0 0 1-.006.127 12.3 12.3 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
            </svg>
          </a>
          <a href="/contact" class="footer-pop inline-flex min-h-6 min-w-6 items-center justify-center p-1 text-slate-400 hover:text-emerald-400" aria-label="Telegram">
            <svg class="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.531 6.998-3.02 3.332-1.387 4.025-1.627 4.476-1.635z" />
            </svg>
          </a>
          <a href="https://raw.githubusercontent.com/spreadzp/agentbadge/refs/heads/main/AGENT-REFERENCE.md" target="_blank" rel="noopener" class="footer-pop inline-flex min-h-6 min-w-6 items-center justify-center p-1 text-slate-400 hover:text-emerald-400" aria-label="GitHub">
            <svg class="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c 0-6.627-5.373-12-12-12" />
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
          <a href="/medical-guide" class="footer-pop inline-flex items-center gap-2 py-1 hover:text-emerald-400">
            <svg class="h-4 w-4 shrink-0 text-slate-500" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" /></svg>
            Medical Guide
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
          <a href="https://hashscan.io/testnet" target="_blank" rel="noopener" class="footer-pop inline-flex items-center gap-2 py-1 hover:text-emerald-400">
            <svg class="h-4 w-4 shrink-0 text-slate-500" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-0L10 14" /></svg>
            HashScan
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
          <a href="/team" class="footer-pop inline-flex items-center gap-2 py-1 hover:text-emerald-400">
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
            <svg class="h-4 w-4 shrink-0 text-slate-500" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg>
            Privacy
          </a>
        </div>
      </div>
    </div>
    <div class="border-t border-slate-800 py-4 text-center text-xs text-slate-400">
      © 2026 AgentBadge. MIT License. Built on Hedera.
    </div>
  </footer>`;
}
