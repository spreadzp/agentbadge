import { html, raw } from "hono/html";
import { Layout } from "./layout";
import { type PageMeta, pageTitle } from "../server/lib/page-meta";
import { pageCoreSchemas, articleLd, breadcrumbFor } from "../server/lib/json-ld";
import { type ClusterPageData, getClusterPage } from "../server/lib/cluster-data";
import { RULE_DESCRIPTIONS } from "../agent-readiness/rule-descriptions";

export function ClusterPage(data: ClusterPageData, markdownHtml?: string) {
  const meta: PageMeta = {
    title: data.title,
    description: data.description,
    path: `/${data.slug}`,
  };

  const relatedRules = data.relatedRuleIds
    .map((id) => RULE_DESCRIPTIONS.find((r) => r.rule_id === id))
    .filter(Boolean);

  const relatedPages = data.relatedPages
    .map((slug) => getClusterPage(slug))
    .filter(Boolean);

  const schemas = [
    ...pageCoreSchemas(),
    articleLd({
      title: data.title,
      description: data.description,
      path: `/${data.slug}`,
      sections: [
        { title: "Direct Answer", body: data.directAnswer },
      ],
    }),
    breadcrumbFor(`/${data.slug}`, data.title),
  ];

  const content = html`<div class="min-h-screen">
    <div class="mx-auto max-w-3xl px-4 py-16 md:py-20">
      <!-- Breadcrumbs -->
      <nav class="flex items-center gap-2 text-sm text-slate-500 mb-8" aria-label="Breadcrumb">
        <a href="/" class="hover:text-slate-300 transition-colors">Home</a>
        <span>/</span>
        <span class="text-slate-400">${data.title}</span>
      </nav>

      <!-- Question (H1) -->
      <h1 class="text-3xl md:text-4xl font-bold tracking-tight text-white">${data.question}</h1>

      <!-- Direct Answer -->
      <div class="mt-6 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-6">
        <p class="text-lg text-slate-200 leading-relaxed">${data.directAnswer}</p>
      </div>

      <!-- Explanation (markdown content rendered) -->
      <div class="mt-8 prose prose-invert prose-slate max-w-none">
        ${markdownHtml ? raw(markdownHtml) : ""}
      </div>

      <!-- Evidence: Related Rules -->
      ${relatedRules.length > 0 ? html`<section class="mt-12 border-t border-slate-800 pt-8">
        <h2 class="text-xl font-semibold text-white mb-4">What AgentBadge checks</h2>
        <div class="grid gap-2 sm:grid-cols-2">
          ${raw(relatedRules.map((r) => html`<a href="/rules/${r!.rule_id}" class="block rounded-lg border border-slate-800 bg-slate-900/50 p-3 hover:border-slate-600 hover:bg-slate-800/50 transition-colors">
            <div class="flex items-center gap-2">
              <span class="text-lg">${r!.icon}</span>
              <div>
                <div class="text-xs font-mono text-emerald-400">${r!.rule_id}</div>
                <div class="text-sm text-slate-300">${r!.title}</div>
              </div>
            </div>
          </a>`).join(""))}
        </div>
      </section>` : ""}

      <!-- AgentBadge Measurement -->
      <section class="mt-8 border-t border-slate-800 pt-8">
        <h2 class="text-xl font-semibold text-white mb-3">How AgentBadge measures this</h2>
        <p class="text-slate-400 leading-relaxed">
          AgentBadge scans your API against ${relatedRules.length} rules related to this topic.
          Each rule is checked deterministically with evidence. Run a scan to see your score.
        </p>
        <a href="/#scan" class="mt-4 inline-flex items-center gap-2 rounded-lg bg-emerald-500 px-5 py-2.5 font-medium text-slate-950 hover:bg-emerald-400 transition-colors">
          Scan your site
          <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 7l5 5m0 0l-5 5m5-5H6" />
          </svg>
        </a>
      </section>

      <!-- Related Pages -->
      ${relatedPages.length > 0 ? html`<section class="mt-8 border-t border-slate-800 pt-8">
        <h2 class="text-lg font-semibold text-white mb-4">Related</h2>
        <div class="grid gap-2">
          ${raw(relatedPages.map((p) => html`<a href="/${p!.slug}" class="block rounded-lg border border-slate-800 bg-slate-900/50 p-4 hover:border-slate-600 hover:bg-slate-800/50 transition-colors">
            <div class="text-sm text-slate-300">${p!.question}</div>
          </a>`).join(""))}
        </div>
      </section>` : ""}
    </div>
  </div>`;

  return Layout(content.toString(), pageTitle(meta.title), meta, schemas);
}
