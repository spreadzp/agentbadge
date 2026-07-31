import { html, raw } from "hono/html";
import { type PageMeta, SITE_DESCRIPTION, BASE_URL } from "../../server/lib/page-meta";
import { renderJsonLd, defaultCoreSchemas } from "../../server/lib/json-ld";
import { LandingHeader } from "./header";
import { Footer } from "../footer";

/**
 * LandingLayout — HTML shell for the landing page.
 * (SLICE-19-1)
 *
 * Differences from dashboard Layout():
 * - Uses LandingHeader (marketing nav: About, Pricing, Dashboard, Get Started CTA)
 * - No sidebar
 * - Includes skip-to-content link, noscript fallback
 * - Includes CSS animation keyframes (fade-in-up, gradient-shift, pulse-glow, scroll-reveal)
 */
export function LandingLayout(
  children: string,
  title?: string,
  meta?: PageMeta,
  jsonLd?: object[],
): ReturnType<typeof html> {
  const pageTitle = title
    ? `${title} — AgentGate`
    : "AgentGate — On-Chain Identity for AI Agents on Hedera";
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
        <meta name="view-transition" content="same-origin" />
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
        <meta property="og:site_name" content="AgentGate" />
        <meta property="og:locale" content="en_US" />
        <meta name="theme-color" content="#0f172a" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content="${pageTitle}" />
        <meta name="twitter:description" content="${description}" />
        <meta name="twitter:image" content="${ogImage}" />
        <link rel="alternate" type="text/plain" title="LLM Context" href="/llms.txt" />
        <link rel="alternate" type="application/json" title="Agent Card (A2A)" href="/.well-known/agent-card.json" />
        <link rel="service-desc" type="application/json" title="OpenAPI Specs" href="/api/specs" />
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
          /* Landing page animations (SLICE-19-1) */
          @keyframes fade-in-up {
            from { opacity: 0; transform: translateY(20px); }
            to { opacity: 1; transform: translateY(0); }
          }
          @keyframes gradient-shift {
            0%, 100% { background-position: 0% 50%; }
            50% { background-position: 100% 50%; }
          }
          @keyframes pulse-glow {
            0%, 100% { box-shadow: 0 0 0 0 rgba(16,185,129,0.4); }
            50% { box-shadow: 0 0 0 8px rgba(16,185,129,0); }
          }
          .fade-in-up { animation: fade-in-up 0.6s ease-out; }
          .gradient-animated {
            background: linear-gradient(120deg, #10b981, #0ea5e9, #10b981);
            background-size: 200% 200%;
            animation: gradient-shift 8s ease infinite;
          }
          .pulse-glow { animation: pulse-glow 2s ease-in-out infinite; }
          .scroll-reveal {
            animation: fade-in-up 0.6s ease-out both;
            animation-timeline: view();
            animation-range: entry 0% entry 50%;
          }
          .hover-lift {
            transition: transform 0.2s ease-out, box-shadow 0.2s ease-out;
          }
          .hover-lift:hover {
            transform: translateY(-4px);
            box-shadow: 0 12px 24px rgba(0,0,0,0.15);
          }
        </style>
      </head>
      <body class="min-h-full">
        <!-- Skip to content (accessibility) -->
        <a href="#main" class="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-lg focus:bg-emerald-600 focus:px-4 focus:py-2 focus:text-white">
          Skip to content
        </a>

        ${raw(LandingHeader().toString())}

        <main id="main" class="min-h-screen">${raw(children)}</main>

        ${raw(Footer().toString())}

        <noscript>
          <div class="mx-auto max-w-2xl p-8 text-center">
            <h1 class="text-2xl font-bold text-white">AgentGate — On-Chain Identity for AI Agents</h1>
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
