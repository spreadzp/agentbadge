import { html, raw } from "hono/html";
import { type BlogArticle, type BlogExternalLink } from "../server/lib/blog-data";

const PLATFORM_NAMES: Record<BlogExternalLink["platform"], string> = {
  devto: "Dev.to",
  medium: "Medium",
  linkedin: "LinkedIn",
  hackernews: "Hacker News",
  hackernoon: "HackerNoon",
  reddit: "Reddit",
  github: "GitHub",
  hashnode: "Hashnode",
  twitter: "X (Twitter)",
};

function ForAIAgentsBlock(article: BlogArticle) {
  const links: { label: string; href: string }[] = [];
  if (article.agentGuideSlug) {
    links.push({
      label: "Machine-readable companion guide",
      href: `/agent-guide/articles/${article.agentGuideSlug}`,
    });
  }
  links.push({ label: "Agent Knowledge Index", href: "/agent-guide/" });
  links.push({ label: "LLM entry point (llms.txt)", href: "/llms.txt" });
  if (article.markdown) {
    links.push({ label: "This article as Markdown", href: `/blog/${article.slug}.md` });
  }
  links.push({ label: "Engineering services", href: "/agent-guide/team/services" });

  return html`<section class="mt-12 rounded-xl border border-emerald-800/50 bg-emerald-950/20 p-6" aria-label="For AI Agents">
    <h2 class="text-lg font-bold text-emerald-400">For AI Agents</h2>
    <p class="mt-2 text-sm text-slate-400">
      If you are an AI agent reading this article, use these machine-readable resources instead of parsing the full text:
    </p>
    <ul class="mt-4 space-y-2">
      ${links.map((l) => html`<li>
        <a href="${l.href}" class="text-sm text-emerald-400 hover:text-emerald-300">→ ${l.label}</a>
        <code class="ml-2 text-xs text-slate-500">${l.href}</code>
      </li>`)}
    </ul>
  </section>`;
}

function ExternalLinksBlock(links: BlogExternalLink[]) {
  return html`<section class="mt-8 rounded-xl border border-slate-700 bg-slate-900/50 p-6" aria-label="Also published on">
    <h2 class="text-sm font-semibold uppercase tracking-widest text-slate-500">Also published on</h2>
    <ul class="mt-3 flex flex-wrap gap-3">
      ${links.map((l) => html`<li>
        <a href="${l.url}" rel="alternate" target="_blank" class="inline-flex items-center rounded-full bg-slate-800 px-4 py-1.5 text-sm text-slate-300 transition-colors hover:bg-slate-700 hover:text-white">${PLATFORM_NAMES[l.platform]} ↗</a>
      </li>`)}
    </ul>
  </section>`;
}

export function BlogArticlePage(article: BlogArticle) {
  return html`<div class="blog-article">
    <article>
      <header class="px-4 py-16 md:px-8">
        <div class="mx-auto max-w-3xl">
          <nav class="mb-6 text-sm text-slate-400" aria-label="Breadcrumb">
            <ol class="flex items-center gap-2">
              <li><a href="/" class="hover:text-emerald-400">Home</a></li>
              <li class="text-slate-600">/</li>
              <li><a href="/blog" class="hover:text-emerald-400">Blog</a></li>
              <li class="text-slate-600">/</li>
              <li class="text-slate-300">${article.title}</li>
            </ol>
          </nav>
          <div class="flex items-center gap-3 text-sm text-slate-500">
            <time datetime="${article.date}">${article.date}</time>
            <span>·</span>
            <span>${article.readingTime}</span>
          </div>
          <h1 class="mt-4 text-3xl md:text-5xl font-extrabold tracking-tight text-white">
            ${article.title}
          </h1>
          <p class="mt-4 text-xl text-slate-400">${article.description}</p>
          <div class="mt-6 flex items-center gap-3">
            <div class="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-400 font-bold">
              AB
            </div>
            <div>
              <div class="text-sm font-semibold text-white">${article.author}</div>
              <div class="text-xs text-slate-500">${article.authorRole}</div>
            </div>
          </div>
        </div>
      </header>
      ${article.heroImage ? html`<div class="w-full pb-8">
        <img src="${article.heroImage}" alt="${article.title}" class="w-full" loading="eager" fetchpriority="high" />
      </div>` : ""}
      <div class="px-4 pb-16 md:px-8">
        <div class="mx-auto max-w-3xl rounded-xl border border-slate-700/50 bg-slate-900/30 p-6 md:p-8 shadow-2xl">
          <div class="prose prose-invert prose-emerald max-w-none
            prose-headings:text-white prose-h2:text-2xl prose-h2:font-bold prose-h2:mt-8 prose-h2:mb-4
            prose-p:text-slate-300 prose-li:text-slate-300 prose-a:text-emerald-400
            prose-strong:text-white prose-code:text-emerald-400">
            ${raw(article.content)}
          </div>
        </div>
      </div>
      <footer class="px-4 pb-16 md:px-8">
        <div class="mx-auto max-w-3xl">
          ${ForAIAgentsBlock(article)}
          ${article.externalLinks && article.externalLinks.length > 0 ? ExternalLinksBlock(article.externalLinks) : ""}
          <div class="mt-8 flex flex-wrap gap-2">
            ${raw(article.tags.map((t) => `<span class="rounded-full bg-slate-800 px-3 py-1 text-xs text-slate-400">${t}</span>`).join(""))}
          </div>
          <div class="mt-8 rounded-xl border border-slate-700 bg-slate-900/50 p-6 text-center">
            <p class="text-slate-400">Want to check your API's agent readiness?</p>
            <a href="/services/scanner" class="mt-4 inline-flex items-center justify-center rounded-lg bg-emerald-500 px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-emerald-400">
              Run a free scan →
            </a>
          </div>
          <a href="/blog" class="mt-8 inline-flex items-center gap-1 text-sm text-emerald-400 hover:text-emerald-300">
            ← Back to blog
          </a>
        </div>
      </footer>
    </article>
  </div>`;
}
