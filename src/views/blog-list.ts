import { html, raw } from "hono/html";
import { BLOG_ARTICLES, type BlogArticle } from "../server/lib/blog-data";

export function BlogListPage() {
  const articles = BLOG_ARTICLES;
  const cards = articles
    .map((a) => articleCard(a))
    .join("");

  return html`<div class="blog-list">
    <section class="px-4 py-16 md:px-8">
      <div class="mx-auto max-w-4xl">
        <div class="text-xs font-mono uppercase tracking-widest text-emerald-400">
          AgentBadge Blog
        </div>
        <h1 class="mt-4 text-4xl md:text-5xl font-extrabold tracking-tight text-white">
          Insights on Agent Readiness
        </h1>
        <p class="mt-4 text-lg text-slate-400 max-w-2xl">
          Deep dives into agent-ready infrastructure, MCP protocol, x402 payments, and the agentic web.
        </p>
      </div>
    </section>
    <section class="px-4 pb-16 md:px-8">
      <div class="mx-auto max-w-4xl space-y-6">
        ${raw(cards)}
      </div>
    </section>
  </div>`;
}

function articleCard(a: BlogArticle): string {
  return `<article class="blog-post rounded-xl border border-slate-700 bg-slate-900/50 p-6 transition-all hover:border-emerald-500">
    <div class="flex items-center gap-3 text-sm text-slate-500">
      <time datetime="${a.date}">${a.date}</time>
      <span>·</span>
      <span>${a.readingTime}</span>
    </div>
    <h2 class="mt-3 text-2xl font-bold text-white">
      <a href="/blog/${a.slug}" class="hover:text-emerald-400">${a.title}</a>
    </h2>
    <p class="mt-2 text-slate-400">${a.description}</p>
    <div class="mt-4 flex flex-wrap gap-2">
      ${a.tags.map((t) => `<span class="rounded-full bg-slate-800 px-3 py-1 text-xs text-slate-400">${t}</span>`).join("")}
    </div>
    <a href="/blog/${a.slug}" class="mt-4 inline-flex items-center gap-1 text-sm text-emerald-400 hover:text-emerald-300">
      Read more →
    </a>
  </article>`;
}
