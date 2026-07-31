import { html, raw } from "hono/html";
import { BASE_URL } from "../server/lib/page-meta";
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
): ReturnType<typeof html> {
  const jsonLdHtml = renderJsonLd(jsonLd);
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
        <title>${title} — AgentGate</title>
        <meta name="description" content="${title} for AI agents on AgentGate — Hedera on-chain identity platform." />
        <link rel="canonical" href="${BASE_URL}" />
        <link rel="alternate" type="text/markdown" title="Markdown version" href="" />
        ${raw(jsonLdHtml)}
        <script src="https://cdn.tailwindcss.com" defer></script>
      </head>
      <body class="min-h-full">
        <div class="mx-auto max-w-4xl px-4 py-8">
          <a href="/" class="text-sm text-emerald-400 hover:text-emerald-300">&larr; Back to AgentGate</a>
          <pre class="mt-4 whitespace-pre-wrap font-mono text-sm text-slate-300 leading-relaxed">${raw(escapedMarkdown)}</pre>
        </div>
      </body>
    </html>`;
}
