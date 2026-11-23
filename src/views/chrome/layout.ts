import { html, raw } from "hono/html";
import { type PageMeta, SITE_NAME, SITE_DESCRIPTION, BASE_URL, pageTitle, markdownAlternatePath } from "../../server/lib/page-meta";
import { renderJsonLd, defaultCoreSchemas } from "../../server/lib/json-ld";
import { getPlausibleScript } from "../../server/lib/plausible";
import { getGA4Script } from "../../server/lib/ga4-script";
import { getMetaPixelScript } from "../../server/lib/meta-pixel";
import { getGscVerificationMeta } from "../../server/lib/gsc-verification";
import { Footer } from "../chrome/footer";
import { chromeHeaderNav } from "./layout-nav";
import { chromeSideNav } from "./layout-sidenav";

/**
 * HTML shell layout with HTMX + Tailwind CDN.
 * (SLICE-4-1, SLICE-4-3, SLICE-18-1, SLICE-18-4)
 *
 * Style: slate-* palette + emerald accents, matching Facilitator project.
 */
export function Layout(children: string, title?: string, meta?: PageMeta, jsonLd?: object[], noIndex?: boolean) {
  const composedTitle = title
    ? pageTitle(title)
    : meta?.title
      ? pageTitle(meta.title)
      : pageTitle("");
  const description = meta?.description ?? SITE_DESCRIPTION;
  const selfPath = meta?.path ?? "/";
  const canonicalPath = noIndex ? "/" : (meta?.canonical ?? selfPath);
  const canonicalUrl = `${BASE_URL}${canonicalPath}`;
  const ogImage = `${BASE_URL}/icons/og-image.png`;
  // Arc R4 M-11: operator surfaces don't carry third-party analytics
  // scripts — the pageview middleware already skips /admin, but the
  // script tags themselves would still load and read admin DOM.
  const analytics =
    !(meta?.path.startsWith("/admin") ?? false) &&
    !(meta?.path.startsWith("/intel") ?? false);
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
        <title>${composedTitle}</title>
        <meta name="description" content="${description}" />
        ${noIndex ? raw('<meta name="robots" content="noindex, nofollow" />') : raw('<meta name="robots" content="max-image-preview:large, max-snippet:-1, max-video-preview:-1" />')}
        <link rel="canonical" href="${canonicalUrl}" />
        ${noIndex ? "" : html`<link rel="alternate" type="text/markdown" title="Markdown version" href="${markdownAlternatePath(selfPath)}" />`}
        <meta property="og:title" content="${composedTitle}" />
        <meta property="og:description" content="${description}" />
        <meta property="og:type" content="website" />
        <meta property="og:url" content="${canonicalUrl}" />
        <meta property="og:image" content="${ogImage}" />
        <meta property="og:image:width" content="1200" />
        <meta property="og:image:height" content="630" />
        <meta property="og:site_name" content="${SITE_NAME}" />
        <meta property="og:locale" content="en_US" />
        <meta name="theme-color" content="#0f172a" />
        <meta name="ai-agent-discovery" content="${BASE_URL}/llms.txt" />
        <meta name="ai-agent-onboarding" content="${BASE_URL}/skill.md" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content="${composedTitle}" />
        <meta name="twitter:description" content="${description}" />
        <meta name="twitter:image" content="${ogImage}" />
        <meta name="twitter:site" content="@agentbadge" />
        <meta property="og:image:alt" content="${SITE_NAME} — Agency for the Agentic Web" />
        <link rel="manifest" href="/manifest.json" />
        <link rel="alternate" type="text/markdown" title="LLM Context" href="/llms.txt" />
        <link rel="alternate" type="text/markdown" title="Full Documentation" href="https://agentbadge.gitbook.io/agentbadge-docs" />
        <link rel="alternate" type="application/json" title="Agent Card (A2A)" href="/.well-known/agent-card.json" />
        <link rel="service-desc" type="application/json" title="OpenAPI Specs" href="/api/specs" />
        ${meta?.prevRel ? html`<link rel="prev" href="${meta.prevRel}" />` : ""}
        ${meta?.nextRel ? html`<link rel="next" href="${meta.nextRel}" />` : ""}
        ${meta?.jsonUrl ? html`<link rel="alternate" type="application/json" title="Machine-Readable Rule" href="${meta.jsonUrl}" />` : ""}
        <link rel="security.txt" href="/.well-known/security.txt" />
        <link rel="preconnect" href="https://agentbadge.gitbook.io" crossorigin />
        <link rel="dns-prefetch" href="https://agentbadge.gitbook.io" />
        <link rel="preload" href="/css/tailwind.css?v=3" as="style" />
        ${raw(getGscVerificationMeta())}
        ${raw(jsonLdHtml)}
        ${analytics ? raw(getGA4Script()) : ""}
        ${analytics ? raw(getPlausibleScript()) : ""}
        ${analytics ? raw(getMetaPixelScript()) : ""}
        <script src="/js/vendor/htmx.min.js" defer></script>
        <link rel="stylesheet" href="/css/tailwind.css?v=3" />
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
            display: inline-flex;
            align-items: center;
          }
          .footer-pop:hover {
            animation: nav-pop 0.3s ease-out forwards;
            color: #34d399;
          }
          :focus-visible {
            outline: 2px solid #10b981;
            outline-offset: 2px;
          }
          .skip-link {
            position: absolute;
            top: -40px;
            left: 0;
            z-index: 100;
            padding: 8px 16px;
            background: #10b981;
            color: #fff;
            border-radius: 0 0 8px 0;
            font-size: 14px;
            transition: top 0.2s;
          }
          .skip-link:focus {
            top: 0;
          }
          @media (prefers-reduced-motion: reduce) {
            *, *::before, *::after {
              animation-duration: 0.01ms !important;
              animation-iteration-count: 1 !important;
              transition-duration: 0.01ms !important;
            }
          }
        </style>
      </head>
      <body class="min-h-full">
        <!-- Skip to content (accessibility) -->
        <a href="#main" class="skip-link">Skip to content</a>
        <!-- Header: full width, always visible -->        ${chromeHeaderNav()}

        <!-- Content area: sidebar + main in flex row (desktop), main only (mobile) -->
        <div class="flex">
          <!-- Sidebar collapse toggle (desktop only, pure CSS) -->
          <input id="sidebar-toggle" type="checkbox" class="peer hidden" />

          <!-- Desktop sidebar: collapsible via peer-checked -->          ${chromeSideNav()}

          <!-- Main content: flex-1 auto-adjusts when sidebar collapses -->
          <main id="main" class="min-w-0 flex-1 px-4 py-8 md:px-8">${raw(children)}</main>
        </div>
        ${raw(Footer().toString())}

        <noscript>
          <div class="mx-auto max-w-2xl p-8 text-center">
            <p class="text-2xl font-bold text-white">${SITE_NAME} — Agency for the Agentic Web</p>
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
