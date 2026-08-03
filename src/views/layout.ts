import { html, raw } from "hono/html";
import { type PageMeta, SITE_NAME, SITE_DESCRIPTION, BASE_URL } from "../server/lib/page-meta";
import { renderJsonLd, defaultCoreSchemas } from "../server/lib/json-ld";
import { Footer } from "./footer";

/**
 * HTML shell layout with HTMX + Tailwind CDN.
 * (SLICE-4-1, SLICE-4-3, SLICE-18-1, SLICE-18-4)
 *
 * Style: slate-* palette + emerald accents, matching Facilitator project.
 */
export function Layout(children: string, title?: string, meta?: PageMeta, jsonLd?: object[]) {
  const pageTitle = title
    ? `${title} — ${SITE_NAME}`
    : `${SITE_NAME} — On-chain Identity for AI Agents on Hedera`;
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
        <meta property="og:image:width" content="1200" />
        <meta property="og:image:height" content="630" />
        <meta property="og:site_name" content="${SITE_NAME}" />
        <meta property="og:locale" content="en_US" />
        <meta name="theme-color" content="#0f172a" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content="${pageTitle}" />
        <meta name="twitter:description" content="${description}" />
        <meta name="twitter:image" content="${ogImage}" />
        <meta name="twitter:site" content="@agentbadge" />
        <meta property="og:image:alt" content="${SITE_NAME} — On-Chain Identity for AI Agents on Hedera" />
        <link rel="manifest" href="/manifest.json" />
        <link rel="alternate" type="text/markdown" title="LLM Context" href="/llms.txt" />
        <link rel="alternate" type="application/json" title="Agent Card (A2A)" href="/.well-known/agent-card.json" />
        <link rel="service-desc" type="application/json" title="OpenAPI Specs" href="/api/specs" />
        <link rel="security.txt" href="/.well-known/security.txt" />
        <link rel="preconnect" href="https://unpkg.com" crossorigin />
        <link rel="dns-prefetch" href="https://unpkg.com" />
        <link rel="preload" href="/css/tailwind.css" as="style" />
        ${raw(jsonLdHtml)}
        <script src="https://unpkg.com/htmx.org@2.0.4" defer></script>
        <link rel="stylesheet" href="/css/tailwind.css" />
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
                <picture><img src="/icons/logo-32.webp" srcset="/icons/logo-64.webp 2x" alt="" class="h-7 w-7 rounded" /></picture>
                ${SITE_NAME}
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
                <a href="/dashboard" class="nav-item-pop flex items-center gap-2 py-2 text-slate-300">
                  <svg class="h-4 w-4 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M3 12l9-9 9 9M5 10v10h14V10" /></svg>
                  Dashboard
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
                <a href="/ui/help" class="nav-item-pop flex items-center gap-2 py-2 text-slate-300">
                  <svg class="h-4 w-4 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093M12 17h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                  Help
                </a>
                <a href="/contact" class="nav-item-pop flex items-center gap-2 py-2 text-slate-300">
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
              <a href="/dashboard" title="Dashboard" class="nav-item-pop flex items-center gap-2.5 rounded-lg px-3 py-2 text-slate-300 hover:bg-slate-800">
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
        ${raw(Footer().toString())}

        <noscript>
          <div class="mx-auto max-w-2xl p-8 text-center">
            <h1 class="text-2xl font-bold text-white">${SITE_NAME} — On-Chain Identity for AI Agents</h1>
            <p class="mt-4 text-slate-400">This page uses HTMX for live data. JavaScript is disabled.</p>
            <a href="/dashboard" class="mt-4 inline-block rounded-lg bg-emerald-500 px-4 py-2 text-white">View Dashboard</a>
          </div>
        </noscript>

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
