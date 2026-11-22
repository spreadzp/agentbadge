/**
 * Chrome nav — split from layout.ts (20KB staged-blob cap).
 * The mobile header nav lives here; the desktop sidebar moved to
 * layout-sidenav.ts (same cap). Layout interpolates the pair.
 */

import { html, raw } from "hono/html";
import { SITE_NAME } from "../../server/lib/page-meta";
import { chainDisplayName, chainBadgeColor, chainBadgeIcon } from "../../server/lib/chain-ui.js";

const BADGE_COLORS: Record<string, string> = {
  blue: "bg-blue-500/10 text-blue-300 border border-blue-500/40",
  purple: "bg-purple-500/10 text-purple-300 border border-purple-500/40",
};

const OPS_BOARD_ICON =
  '<svg class="h-4 w-4 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 17V7m6 10V7m6 10V7M3 17V7m0 10a2 2 0 002 2h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10z" /></svg>';

// Ops board link renders only when the route is mounted (OPS_BOARD_DIR set).
function opsBoardNavMobile() {
  if (!process.env.OPS_BOARD_DIR) return "";
  return `<a href="/ops/board" class="nav-item-pop flex items-center gap-2 py-2 text-slate-300">${OPS_BOARD_ICON}Ops Board</a>`;
}
export function opsBoardNavDesktop() {
  if (!process.env.OPS_BOARD_DIR) return "";
  return `<a href="/ops/board" title="Ops Board" class="nav-item-pop flex items-center gap-2.5 rounded-lg px-3 py-2 text-slate-300 hover:bg-slate-800">${OPS_BOARD_ICON}<span class="nav-text">Ops Board</span></a>`;
}

export function chromeHeaderNav() {
  return html`        <header class="border-b border-slate-800 bg-slate-900">
          <nav class="px-4 py-3">
            <div class="relative flex items-center justify-between">
              <a href="/" class="flex items-center gap-2 font-semibold text-white">
                <picture><img src="/icons/logo-32.webp" srcset="/icons/logo-64.webp 2x" alt="" loading="eager" decoding="async" class="h-7 w-7 rounded" /></picture>
                ${SITE_NAME}
              </a>
              ${chainDisplayName() ? raw(`<span class="chain-badge inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${BADGE_COLORS[chainBadgeColor()] ?? BADGE_COLORS.purple}">${chainBadgeIcon() ? `<img src="${chainBadgeIcon()}" alt="" class="h-3.5 w-auto" loading="eager" decoding="async" />` : ""}${chainDisplayName()}</span>`) : ""}

              <!-- Hamburger toggle (mobile only) — pure CSS, no JS -->
              <input id="nav-toggle" type="checkbox" class="peer hidden" />
              <label for="nav-toggle" class="cursor-pointer text-slate-300 hover:text-white md:hidden" aria-label="Toggle menu">
                <svg class="h-6 w-6" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              </label>

              <!-- Mobile dropdown: absolute overlay below header -->
              <div class="absolute left-0 right-0 top-full z-50 flex flex-col gap-1 overflow-hidden border-b border-slate-800 bg-slate-900 px-4 py-0 text-sm transition-all duration-200 max-h-0 peer-checked:max-h-96 peer-checked:py-3 md:hidden">
                <a href="/services/scanner" class="nav-item-pop flex items-center gap-2 py-2 text-slate-300">
                  <svg class="h-4 w-4 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" /></svg>
                  Scanner
                </a>
                <a href="/services/passports" class="nav-item-pop flex items-center gap-2 py-2 text-slate-300">
                  <svg class="h-4 w-4 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                  Passports
                </a>
                <a href="/services/marketplace" class="nav-item-pop flex items-center gap-2 py-2 text-slate-300">
                  <svg class="h-4 w-4 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" /></svg>
                  Marketplace
                </a>
                <a href="/blog" class="nav-item-pop flex items-center gap-2 py-2 text-slate-300">
                  <svg class="h-4 w-4 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 0a2 2 0 012 2v8a2 2 0 01-2 2m0-12V6m0 12V8m0 0H5" /></svg>
                  Blog
                </a>
                <a href="/dashboard" class="nav-item-pop flex items-center gap-2 py-2 text-slate-300">
                  <svg class="h-4 w-4 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M3 12l9-9 9 9M5 10v10h14V10" /></svg>
                  Dashboard
                </a>
                ${raw(opsBoardNavMobile())}
                <a href="/hackathon/ai-builders" class="nav-item-pop flex items-center gap-2 py-2 text-slate-300">
                  <svg class="h-4 w-4 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
                  AI Builders
                </a>
                <a href="/ui/agents" class="nav-item-pop flex items-center gap-2 py-2 text-slate-300">
                  <svg class="h-4 w-4 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M17 20h5v-2a4 4 0 00-3-3.87M9 20H4v-2a4 4 0 013-3.87m6-1.13a4 4 0 100-8 4 4 0 000 8zm-6 0a3 3 0 100-6 3 3 0 000 6z" /></svg>
                  Agents
                </a>
                <a href="/ui/search" class="nav-item-pop flex items-center gap-2 py-2 text-slate-300">
                  <svg class="h-4 w-4 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                  Search
                </a>
                <a href="/ui/catalog" class="nav-item-pop flex items-center gap-2 py-2 text-slate-300">
                  <svg class="h-4 w-4 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M4 6h16M4 10h16M4 14h16M4 18h16" /></svg>
                  Catalog
                </a>
                <a href="/ui/a2a" class="nav-item-pop flex items-center gap-2 py-2 text-slate-300">
                  <svg class="h-4 w-4 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
                  A2A Inbox
                </a>
                <a href="/ui/market/tasks" class="nav-item-pop flex items-center gap-2 py-2 text-slate-300">
                  <svg class="h-4 w-4 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" /></svg>
                  Marketplace
                </a>
                ${process.env.OPS_BOARD_DIR ? html`
                <a href="/ops/board" class="nav-item-pop flex items-center gap-2 py-2 text-slate-300">
                  <svg class="h-4 w-4 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2" /></svg>
                  Ops Board
                </a>` : ""}
                <a href="/ui/help" class="nav-item-pop flex items-center gap-2 py-2 text-slate-300">
                  <svg class="h-4 w-4 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093M12 17h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                  Help
                </a>
                <a href="/rules" class="nav-item-pop flex items-center gap-2 py-2 text-slate-300">
                  <svg class="h-4 w-4 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" /></svg>
                  Rules
                </a>
                <a href="/contact" class="nav-item-pop flex items-center gap-2 py-2 text-slate-300">
                  <svg class="h-4 w-4 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
                  Contact
                </a>
                <a href="/faq" class="nav-item-pop flex items-center gap-2 py-2 text-slate-300">
                  <svg class="h-4 w-4 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093M12 17h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                  FAQ
                </a>
               
              </div>
            </div>
          </nav>
        </header>`;
}
