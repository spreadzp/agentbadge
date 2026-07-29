import { html, raw } from "hono/html";
import { type PageMeta, SITE_DESCRIPTION, BASE_URL } from "../server/lib/page-meta";
import { renderJsonLd, defaultCoreSchemas } from "../server/lib/json-ld";

/**
 * HTML shell layout with HTMX + Tailwind CDN.
 * (SLICE-4-1, SLICE-4-3, SLICE-18-1, SLICE-18-4)
 *
 * Style: slate-* palette + emerald accents, matching Facilitator project.
 */
export function Layout(children: string, title?: string, meta?: PageMeta, jsonLd?: object[]) {
  const pageTitle = title
    ? `${title} — AgentGate`
    : "AgentGate — On-chain Identity for AI Agents on Hedera";
  const description = meta?.description ?? SITE_DESCRIPTION;
  const canonicalPath = meta?.path ?? "/";
  const canonicalUrl = `${BASE_URL}${canonicalPath}`;
  const ogImage = `${BASE_URL}/icons/og-image.png`;
  const jsonLdHtml = renderJsonLd(jsonLd ?? defaultCoreSchemas());
  return html`<!DOCTYPE html>
    <html lang="en" class="h-full bg-slate-950 text-slate-100">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <link rel="icon" type="image/x-icon" href="/favicon.ico" />
        <link rel="icon" type="image/png" sizes="32x32" href="/icons/favicon-32.png" />
        <link rel="icon" type="image/png" sizes="16x16" href="/icons/favicon-16.png" />
        <link rel="apple-touch-icon" sizes="180x180" href="/icons/apple-touch-icon.png" />
        <title>${pageTitle}</title>
        <meta name="description" content="${description}" />
        <link rel="canonical" href="${canonicalUrl}" />
        <meta property="og:title" content="${pageTitle}" />
        <meta property="og:description" content="${description}" />
        <meta property="og:type" content="website" />
        <meta property="og:url" content="${canonicalUrl}" />
        <meta property="og:image" content="${ogImage}" />
        <meta property="og:site_name" content="AgentGate" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content="${pageTitle}" />
        <meta name="twitter:description" content="${description}" />
        <meta name="twitter:image" content="${ogImage}" />
        <link rel="alternate" type="text/plain" title="LLM Context" href="/llms.txt" />
        <link rel="alternate" type="application/json" title="Agent Card (A2A)" href="/.well-known/agent-card.json" />
        <link rel="service-desc" type="application/json" title="OpenAPI Specs" href="/api/specs" />
        ${raw(jsonLdHtml)}
        <script src="https://unpkg.com/htmx.org@2.0.4"></script>
        <script src="https://cdn.tailwindcss.com"></script>
        <style>
          @keyframes nav-pop {
            0%   { transform: scale(1); }
            55%  { transform: scale(1.08); }
            100% { transform: scale(1.04); }
          }
          .nav-item-pop {
            transition: transform 0.2s ease-out, color 0.25s ease-out;
            transform-origin: left center;
          }
          .nav-item-pop:hover {
            animation: nav-pop 0.3s ease-out forwards;
            color: #34d399;
          }
          .footer-pop {
            transition: transform 0.2s ease-out, color 0.25s ease-out;
            transform-origin: center;
            display: inline-block;
          }
          .footer-pop:hover {
            animation: nav-pop 0.3s ease-out forwards;
            color: #34d399;
          }
        </style>
      </head>
      <body class="min-h-full">
        <!-- Header: full width, always visible -->
        <header class="border-b border-slate-800 bg-slate-900">
          <nav class="px-4 py-3">
            <div class="relative flex items-center justify-between">
              <a href="/" class="flex items-center gap-2 font-semibold text-white">
                <img src="/icons/logo-32.png" alt="AgentGate" class="h-7 w-7 rounded" />
                AgentGate
              </a>

              <!-- Hamburger toggle (mobile only) — pure CSS, no JS -->
              <input id="nav-toggle" type="checkbox" class="peer hidden" />
              <label for="nav-toggle" class="cursor-pointer text-slate-300 hover:text-white md:hidden" aria-label="Toggle menu">
                <svg class="h-6 w-6" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              </label>

              <!-- Mobile dropdown: absolute overlay below header -->
              <div class="absolute left-0 right-0 top-full z-50 flex flex-col gap-1 overflow-hidden border-b border-slate-800 bg-slate-900 px-4 py-0 text-sm transition-all duration-200 max-h-0 peer-checked:max-h-80 peer-checked:py-3 md:hidden">
                <a href="/" class="nav-item-pop flex items-center gap-2 py-1 text-slate-300">
                  <svg class="h-4 w-4 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M3 12l9-9 9 9M5 10v10h14V10" /></svg>
                  Dashboard
                </a>
                <a href="/ui/agents" class="nav-item-pop flex items-center gap-2 py-1 text-slate-300">
                  <svg class="h-4 w-4 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M17 20h5v-2a4 4 0 00-3-3.87M9 20H4v-2a4 4 0 013-3.87m6-1.13a4 4 0 100-8 4 4 0 000 8zm-6 0a3 3 0 100-6 3 3 0 000 6z" /></svg>
                  Agents
                </a>
                <a href="/ui/search" class="nav-item-pop flex items-center gap-2 py-1 text-slate-300">
                  <svg class="h-4 w-4 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                  Search
                </a>
                <a href="/ui/catalog" class="nav-item-pop flex items-center gap-2 py-1 text-slate-300">
                  <svg class="h-4 w-4 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M4 6h16M4 10h16M4 14h16M4 18h16" /></svg>
                  Catalog
                </a>
                <a href="/ui/a2a" class="nav-item-pop flex items-center gap-2 py-1 text-slate-300">
                  <svg class="h-4 w-4 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
                  A2A Inbox
                </a>
                <a href="/ui/market/tasks" class="nav-item-pop flex items-center gap-2 py-1 text-slate-300">
                  <svg class="h-4 w-4 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" /></svg>
                  Marketplace
                </a>
                <a href="/ui/help" class="nav-item-pop flex items-center gap-2 py-1 text-slate-300">
                  <svg class="h-4 w-4 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093M12 17h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                  Help
                </a>
                <a href="/contact" class="nav-item-pop flex items-center gap-2 py-1 text-slate-300">
                  <svg class="h-4 w-4 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
                  Contact
                </a>
               
              </div>
            </div>
          </nav>
        </header>

        <!-- Content area: sidebar + main in flex row (desktop), main only (mobile) -->
        <div class="flex">
          <!-- Sidebar collapse toggle (desktop only, pure CSS) -->
          <input id="sidebar-toggle" type="checkbox" class="peer hidden" />

          <!-- Desktop sidebar: collapsible via peer-checked -->
          <aside
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
              <a href="/" title="Dashboard" class="nav-item-pop flex items-center gap-2.5 rounded-lg px-3 py-2 text-slate-300 hover:bg-slate-800">
                <svg class="h-4 w-4 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M3 12l9-9 9 9M5 10v10h14V10" /></svg>
                <span class="nav-text">Dashboard</span>
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
              <a href="/contact" title="Contact" class="nav-item-pop flex items-center gap-2.5 rounded-lg px-3 py-2 text-slate-300 hover:bg-slate-800">
                <svg class="h-4 w-4 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
                <span class="nav-text">Contact</span>
              </a>
            
            </nav>
          </aside>

          <!-- Main content: flex-1 auto-adjusts when sidebar collapses -->
          <main class="min-w-0 flex-1 px-4 py-8 md:px-8">${raw(children)}</main>
        </div>
        <footer class="border-t border-slate-800 bg-slate-900">
          <div class="flex flex-col items-center justify-between gap-4 px-4 py-6 sm:flex-row">
            <div class="flex items-center gap-2 text-sm text-slate-400">
              <img src="/icons/logo-32.png" alt="AgentGate" class="h-5 w-5 rounded" />
              <span>AgentGate · On-chain identity for AI agents on Hedera</span>
            </div>
            <div class="flex flex-col text-sm text-slate-400 sm:flex-row sm:gap-4">
              
              <a href="/agent-guide" class="footer-pop hover:text-emerald-400">Agent Guide</a>
              <a href="/market-guide" class="footer-pop hover:text-emerald-400">Market Guide</a>
              <a href="/medical-guide" class="footer-pop hover:text-emerald-400">Medical Guide</a>
              <a href="/ui/medical-demo" class="footer-pop hover:text-emerald-400">Medical Demo</a>
              <a href="https://hashscan.io/testnet" target="_blank" rel="noopener" class="footer-pop hover:text-emerald-400">HashScan</a>
            </div>
          </div>
          <div class="flex items-center justify-center gap-4 border-t border-slate-800 px-4 py-4">
            <a href="/contact" class="footer-pop text-slate-400 hover:text-emerald-400" aria-label="Discord">
              <svg class="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M20.317 4.37a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.872-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.094.252-.192.372-.291a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.009c.12.099.246.198.373.292a.077.077 0 0 1-.006.127 12.3 12.3 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
              </svg>
            </a>
            <a href="/contact" class="footer-pop text-slate-400 hover:text-emerald-400" aria-label="Telegram">
              <svg class="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.531 6.998-3.02 3.332-1.387 4.025-1.627 4.476-1.635z" />
              </svg>
            </a>
            <a href="https://github.com/spreadzp/agentgate" target="_blank" rel="noopener" class="footer-pop text-slate-400 hover:text-emerald-400" aria-label="GitHub">
              <svg class="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
              </svg>
            </a>
          </div>
        </footer>
        <script>
          function showMore(btn, count) {
            var container = btn.previousElementSibling;
            var hidden = container.querySelectorAll('[data-paginated="true"]');
            var toShow = Array.from(hidden).slice(0, count);
            toShow.forEach(function(el) { el.removeAttribute('data-paginated'); el.classList.remove('hidden'); });
            var remaining = container.querySelectorAll('[data-paginated="true"]').length;
            if (remaining === 0) { btn.remove(); }
            else { btn.querySelector('.show-more-remaining').textContent = remaining; }
          }
        </script>
      </body>
    </html>`;
}
