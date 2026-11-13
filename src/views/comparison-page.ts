import { html, raw } from "hono/html";
import { Layout } from "./layout";
import { type PageMeta, pageTitle } from "../server/lib/page-meta";
import { pageCoreSchemas, articleLd, breadcrumbFor } from "../server/lib/json-ld";
import { type ComparisonPageData, getComparisonPage } from "../server/lib/comparison-data";

/**
 * Individual comparison page (e.g. AgentBadge vs MCP). H1 is the reader's
 * question, followed by a feature table, verdict, authored markdown body,
 * and links to the other comparisons. Replaces the audit-flagged stub.
 */
export function ComparisonPage(data: ComparisonPageData, markdownHtml?: string) {
  const path = `/comparisons/${data.slug}`;
  const meta: PageMeta = {
    title: data.title,
    description: data.description,
    path,
  };

  const related = data.relatedPages
    .map((slug) => getComparisonPage(slug))
    .filter((p): p is ComparisonPageData => Boolean(p));

  const schemas = [
    ...pageCoreSchemas(),
    articleLd({
      title: data.title,
      description: data.description,
      path,
      sections: [{ title: "Overview", body: data.description }],
    }),
    breadcrumbFor(path, data.title),
  ];

  const featureRows = data.features
    .map(
      (f) => `<tr class="border-b border-slate-800 last:border-0">
        <td class="py-3 pr-4 font-semibold text-slate-200">${f.feature}</td>
        <td class="py-3 pr-4 text-slate-400">${f.agentbadge}</td>
        <td class="py-3 text-slate-400">${f.tool}</td>
      </tr>`,
    )
    .join("\n");

  const relatedLinks = related
    .map(
      (p) => html`<a
        href="/comparisons/${p.slug}"
        class="block rounded-lg border border-slate-700 px-4 py-3 text-sm text-slate-300 transition-colors hover:border-emerald-600 hover:text-emerald-400"
        >${p.title} →</a>`,
    )
    .join("\n");

  const content = html`<div class="min-h-screen">
    <div class="mx-auto max-w-3xl px-4 py-16 md:py-20">
      <nav class="flex items-center gap-2 text-sm text-slate-500 mb-8" aria-label="Breadcrumb">
        <a href="/" class="hover:text-slate-300 transition-colors">Home</a>
        <span>/</span>
        <a href="/comparisons" class="hover:text-slate-300 transition-colors">Comparisons</a>
        <span>/</span>
        <span class="text-slate-400">${data.title}</span>
      </nav>

      <h1 class="text-3xl md:text-4xl font-bold tracking-tight text-white">${data.question}</h1>
      <p class="mt-4 text-lg text-slate-400">${data.description}</p>

      <section class="mt-10">
        <h2 class="text-xl font-bold text-slate-100 mb-4">Feature comparison</h2>
        <div class="overflow-x-auto rounded-xl border border-slate-800">
          <table class="w-full text-left text-sm">
            <thead>
              <tr class="border-b border-slate-700 text-xs uppercase tracking-wider text-slate-500">
                <th class="py-3 pr-4 pl-4">Feature</th>
                <th class="py-3 pr-4">AgentBadge</th>
                <th class="py-3">${data.tool}</th>
              </tr>
            </thead>
            <tbody>${raw(featureRows)}</tbody>
          </table>
        </div>
      </section>

      <section class="mt-8 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-6">
        <h2 class="text-lg font-bold text-emerald-300 mb-2">Verdict</h2>
        <p class="text-slate-300">${data.verdict}</p>
      </section>

      <article class="prose prose-invert prose-slate mt-10 max-w-none prose-a:text-emerald-400 prose-headings:text-white prose-code:text-emerald-300">
        ${raw(markdownHtml ?? "")}
      </article>

      <section class="mt-12">
        <h2 class="text-lg font-bold text-slate-100 mb-4">Other comparisons</h2>
        <div class="grid gap-3 sm:grid-cols-2">
          ${raw(relatedLinks)}
        </div>
      </section>

      <div class="mt-12 flex flex-wrap items-center justify-between gap-4 border-t border-slate-800 pt-6">
        <a href="/comparisons" class="text-sm text-slate-500 hover:text-slate-300 transition-colors">
          ← All comparisons
        </a>
        <a href="/#scan" class="inline-block rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500 transition-colors">
          Scan Your Site →
        </a>
      </div>
    </div>
  </div>`;

  return Layout(content.toString(), pageTitle(data.title), meta, schemas);
}
