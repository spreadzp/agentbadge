import { html, raw } from "hono/html";
import { SITE_NAME, BASE_URL } from "../server/lib/page-meta";
import { renderJsonLd } from "../server/lib/json-ld";

/**
 * GuideLayout — HTML shell for guide pages (/agent-guide, /market-guide, /medical-guide).
 * Wraps markdown content in HTML with JSON-LD structured data for SEO.
 * (SLICE-21-1)
 */
export function GuideLayout(
  title: string,
  markdown: string,
  jsonLd: object[],
  path: string = "",
  lastUpdated: string = new Date().toISOString().split("T")[0],
): ReturnType<typeof html> {
  const jsonLdHtml = renderJsonLd(jsonLd);
  const canonicalUrl = path ? `${BASE_URL}${path}` : BASE_URL;
  const escapedMarkdown = markdown
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  return html`<!DOCTYPE html>
    <html lang="en" class="h-full bg-slate-950 text-slate-100">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <link rel="icon" type="image/x-icon" href="/favicon.ico" />
        <title>${title} — ${SITE_NAME}</title>
        <meta name="description" content="${title} for AI agents on ${SITE_NAME} — Hedera on-chain identity platform." />
        <link rel="canonical" href="${canonicalUrl}" />
        <meta property="og:title" content="${title} — ${SITE_NAME}" />
        <meta property="og:description" content="${title} for AI agents on ${SITE_NAME} — Hedera on-chain identity platform." />
        <meta property="og:type" content="article" />
        <meta property="og:url" content="${canonicalUrl}" />
        <meta property="og:image" content="${BASE_URL}/icons/og-image.png" />
        <meta property="og:site_name" content="${SITE_NAME}" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content="${title} — ${SITE_NAME}" />
        <meta name="twitter:description" content="${title} for AI agents on ${SITE_NAME} — Hedera on-chain identity platform." />
        <meta name="twitter:image" content="${BASE_URL}/icons/og-image.png" />
        <meta name="twitter:site" content="@agentbadge" />
        <link rel="manifest" href="/manifest.json" />
        <link rel="alternate" type="text/markdown" title="LLM Context" href="/llms.txt" />
        <link rel="security.txt" href="/.well-known/security.txt" />
        ${raw(jsonLdHtml)}
        <link rel="stylesheet" href="/css/tailwind.css" />
      </head>
      <body class="min-h-full">
        <div class="mx-auto max-w-4xl px-4 py-8">
          <a href="/" class="text-sm text-emerald-400 hover:text-emerald-300">&larr; Back to ${SITE_NAME}</a>
          <p class="mt-2 text-xs text-slate-500">Last updated: <time datetime="${lastUpdated}">${lastUpdated}</time></p>
          <pre class="mt-4 whitespace-pre-wrap font-mono text-sm text-slate-300 leading-relaxed">${raw(escapedMarkdown)}</pre>
        </div>
      </body>
    </html>`;
}
