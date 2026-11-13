import { html, raw } from "hono/html";
import { Layout } from "./layout";
import { type PageMeta, pageTitle } from "../server/lib/page-meta";
import { pageCoreSchemas, breadcrumbFor, collectionPageLd } from "../server/lib/json-ld";
import { COMPARISON_PAGES } from "../server/lib/comparison-data";

const OVERVIEW_DOES: Record<string, { does: string; agentbadge: string }> = {
  "agentbadge-vs-mcp": { does: "Connects agents to tools", agentbadge: "Measures & certifies API readiness" },
  "agentbadge-vs-postman": { does: "Tests APIs for humans", agentbadge: "Certifies readiness for AI agents" },
  "agentbadge-vs-swagger": { does: "Documents APIs", agentbadge: "Verifies docs + discovery + action" },
};

/**
 * /comparisons hub — overview table + cards to each detailed comparison.
 * Replaces the audit-flagged stub page.
 */
export function ComparisonHubPage() {
  const meta: PageMeta = {
    title: "AgentBadge vs Other Tools — Comparisons",
    description:
      "How AgentBadge compares to MCP, Postman, and Swagger: complementary tools, different goals. What each does and where agent-readiness certification fits.",
    path: "/comparisons",
  };

  const schemas = [
    ...pageCoreSchemas(),
    collectionPageLd({
      name: meta.title,
      description: meta.description,
      path: "/comparisons",
    }),
    breadcrumbFor("/comparisons", "Comparisons"),
  ];

  const rows = COMPARISON_PAGES.map((p) => {
    const o = OVERVIEW_DOES[p.slug] ?? { does: p.description, agentbadge: "Certifies API readiness" };
    return `<tr class="border-b border-slate-800 last:border-0">
      <td class="py-3 pr-4 font-semibold text-slate-200">${p.tool}</td>
      <td class="py-3 pr-4 text-slate-400">${o.does}</td>
      <td class="py-3 pr-4 text-slate-400">${o.agentbadge}</td>
      <td class="py-3 text-emerald-400">${p.verdict}</td>
    </tr>`;
  }).join("\n");

  const cards = COMPARISON_PAGES.map(
    (p) => html`<a
      href="/comparisons/${p.slug}"
      class="block rounded-xl border border-slate-700 bg-slate-800/40 p-6 transition-colors hover:border-emerald-600 hover:bg-slate-800/70"
    >
      <h2 class="text-lg font-semibold text-white">${p.title}</h2>
      <p class="mt-2 text-sm text-slate-400">${p.description}</p>
      <span class="mt-4 inline-block text-sm font-medium text-emerald-400">Read the comparison →</span>
    </a>`,
  );

  const content = html`<div class="min-h-screen">
    <div class="mx-auto max-w-4xl px-4 py-16 md:py-24">
      <div class="text-center mb-12">
        <div class="text-xs font-mono uppercase tracking-widest text-emerald-400 mb-3">Comparisons</div>
        <h1 class="text-4xl md:text-5xl font-bold tracking-tight text-white">AgentBadge vs Other Tools</h1>
        <p class="mt-4 text-lg text-slate-400 max-w-2xl mx-auto">
          AgentBadge doesn't replace your API tooling — it certifies that your API is ready for AI agents.
          Here's how it fits alongside the tools you already use.
        </p>
      </div>

      <h2 class="text-xl font-bold text-slate-100 mb-4">Overview</h2>
      <div class="overflow-x-auto rounded-xl border border-slate-800 mb-12">
        <table class="w-full text-left text-sm">
          <thead>
            <tr class="border-b border-slate-700 text-xs uppercase tracking-wider text-slate-500">
              <th class="py-3 pr-4 pl-4">Tool</th>
              <th class="py-3 pr-4">What it does</th>
              <th class="py-3 pr-4">What AgentBadge does</th>
              <th class="py-3">Verdict</th>
            </tr>
          </thead>
          <tbody>${raw(rows)}</tbody>
        </table>
      </div>

      <div class="grid gap-4 sm:grid-cols-1">
        ${raw(cards)}
      </div>

      <div class="mt-12 text-center">
        <a href="/#scan" class="inline-block rounded-lg bg-emerald-600 px-6 py-3 font-semibold text-white hover:bg-emerald-500 transition-colors">
          Scan Your Site →
        </a>
      </div>
    </div>
  </div>`;

  return Layout(content.toString(), pageTitle(meta.title), meta, schemas);
}
