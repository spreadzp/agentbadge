/**
 * Chrome sidebar nav — split from layout-nav.ts (20KB staged-blob
 * cap). The collapsible desktop sidebar; Layout interpolates it as
 * ${chromeSideNav()}. See layout-nav.ts for the ops-board helper.
 */

import { html, raw } from "hono/html";
import { opsBoardNavDesktop } from "./layout-nav";

export function chromeSideNav() {
  return html`          <aside
            class="hidden w-64 shrink-0 overflow-hidden border-r border-slate-800 bg-slate-900 px-4 py-6 transition-all duration-200 md:block peer-checked:w-16 peer-checked:px-2 peer-checked:[&_.nav-text]:hidden peer-checked:[&_a]:justify-center peer-checked:[&_a]:px-2 peer-checked:[&_label]:justify-center peer-checked:[&_.toggle-arrow]:rotate-180"
          >
            <!-- Collapse/expand toggle button -->
            <label
              for="sidebar-toggle"
              class="mb-4 flex cursor-pointer items-center justify-end gap-2.5 rounded-lg px-3 py-2 text-slate-400 hover:bg-slate-800 hover:text-white"
              aria-label="Toggle sidebar"
            >
              <svg class="toggle-arrow h-4 w-4 shrink-0 transition-transform duration-200" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M11 19l-7-7 7-7m8 14l-7-7 7-7" /></svg>
            </label>

            <nav class="flex flex-col gap-1 text-sm">
              <span class="mb-1 px-3 text-xs font-semibold uppercase tracking-wider text-slate-500">Services</span>
              <a href="/services/scanner" title="Scanner" class="nav-item-pop flex items-center gap-2.5 rounded-lg px-3 py-2 text-slate-300 hover:bg-slate-800">
                <svg class="h-4 w-4 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" /></svg>
                <span class="nav-text">Scanner</span>
              </a>
              <a href="/services/passports" title="Passports" class="nav-item-pop flex items-center gap-2.5 rounded-lg px-3 py-2 text-slate-300 hover:bg-slate-800">
                <svg class="h-4 w-4 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                <span class="nav-text">Passports</span>
              </a>
              <a href="/services/marketplace" title="Marketplace" class="nav-item-pop flex items-center gap-2.5 rounded-lg px-3 py-2 text-slate-300 hover:bg-slate-800">
                <svg class="h-4 w-4 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" /></svg>
                <span class="nav-text">Marketplace</span>
              </a>
              <a href="/blog" title="Blog" class="nav-item-pop flex items-center gap-2.5 rounded-lg px-3 py-2 text-slate-300 hover:bg-slate-800">
                <svg class="h-4 w-4 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 0a2 2 0 012 2v8a2 2 0 01-2 2m0-12V6m0 12V8m0 0H5" /></svg>
                <span class="nav-text">Blog</span>
              </a>
              <span class="mb-1 mt-3 px-3 text-xs font-semibold uppercase tracking-wider text-slate-500">Hackathons</span>
              <a href="/hackathon/ai-builders" title="AI Builders" class="nav-item-pop flex items-center gap-2.5 rounded-lg px-3 py-2 text-slate-300 hover:bg-slate-800">
                <svg class="h-4 w-4 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                <span class="nav-text">AI Builders</span>
              </a>
              <span class="mb-1 mt-3 px-3 text-xs font-semibold uppercase tracking-wider text-slate-500">Platform</span>
              <a href="/dashboard" title="Dashboard" class="nav-item-pop flex items-center gap-2.5 rounded-lg px-3 py-2 text-slate-300 hover:bg-slate-800">
                <svg class="h-4 w-4 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M3 12l9-9 9 9M5 10v10h14V10" /></svg>
                <span class="nav-text">Dashboard</span>
              </a>
              ${raw(opsBoardNavDesktop())}
              <a href="/passport" title="Passport" class="nav-item-pop flex items-center gap-2.5 rounded-lg px-3 py-2 text-slate-300 hover:bg-slate-800">
                <svg class="h-4 w-4 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                <span class="nav-text">Passport</span>
              </a>
              <a href="/ui/agents" title="Agents" class="nav-item-pop flex items-center gap-2.5 rounded-lg px-3 py-2 text-slate-300 hover:bg-slate-800">
                <svg class="h-4 w-4 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M17 20h5v-2a4 4 0 00-3-3.87M9 20H4v-2a4 4 0 013-3.87m6-1.13a4 4 0 100-8 4 4 0 000 8zm-6 0a3 3 0 100-6 3 3 0 000 6z" /></svg>
                <span class="nav-text">Agents</span>
              </a>
              <a href="/ui/search" title="Search" class="nav-item-pop flex items-center gap-2.5 rounded-lg px-3 py-2 text-slate-300 hover:bg-slate-800">
                <svg class="h-4 w-4 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                <span class="nav-text">Search</span>
              </a>
              <a href="/ui/catalog" title="Catalog" class="nav-item-pop flex items-center gap-2.5 rounded-lg px-3 py-2 text-slate-300 hover:bg-slate-800">
                <svg class="h-4 w-4 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M4 6h16M4 10h16M4 14h16M4 18h16" /></svg>
                <span class="nav-text">Catalog</span>
              </a>
              <a href="/ui/a2a" title="A2A Inbox" class="nav-item-pop flex items-center gap-2.5 rounded-lg px-3 py-2 text-slate-300 hover:bg-slate-800">
                <svg class="h-4 w-4 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
                <span class="nav-text">A2A Inbox</span>
              </a>
              ${process.env.OPS_BOARD_DIR ? html`
              <a href="/ops/board" title="Ops Board" class="nav-item-pop flex items-center gap-2.5 rounded-lg px-3 py-2 text-slate-300 hover:bg-slate-800">
                <svg class="h-4 w-4 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2" /></svg>
                <span class="nav-text">Ops Board</span>
              </a>` : ""}
              <a href="/ui/market/tasks" title="Marketplace" class="nav-item-pop flex items-center gap-2.5 rounded-lg px-3 py-2 text-slate-300 hover:bg-slate-800">
                <svg class="h-4 w-4 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" /></svg>
                <span class="nav-text">Marketplace</span>
              </a>
              <a href="/ui/medical-demo" title="Medical Demo" class="nav-item-pop flex items-center gap-2.5 rounded-lg px-3 py-2 text-slate-300 hover:bg-slate-800">
                <svg class="h-4 w-4 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" /></svg>
                <span class="nav-text">Medical Demo</span>
              </a>
              <a href="/ui/help" title="Help" class="nav-item-pop flex items-center gap-2.5 rounded-lg px-3 py-2 text-slate-300 hover:bg-slate-800">
                <svg class="h-4 w-4 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093M12 17h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                <span class="nav-text">Help</span>
              </a>
              <a href="/rules" title="Rules" class="nav-item-pop flex items-center gap-2.5 rounded-lg px-3 py-2 text-slate-300 hover:bg-slate-800">
                <svg class="h-4 w-4 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" /></svg>
                <span class="nav-text">Rules</span>
              </a>
              <a href="/contact" title="Contact" class="nav-item-pop flex items-center gap-2.5 rounded-lg px-3 py-2 text-slate-300 hover:bg-slate-800">
                <svg class="h-4 w-4 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
                <span class="nav-text">Contact</span>
              </a>
              <a href="/faq" title="FAQ" class="nav-item-pop flex items-center gap-2.5 rounded-lg px-3 py-2 text-slate-300 hover:bg-slate-800">
                <svg class="h-4 w-4 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093M12 17h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                <span class="nav-text">FAQ</span>
              </a>
            
            </nav>
          </aside>`;
}
