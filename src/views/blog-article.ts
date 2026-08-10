import { html, raw } from "hono/html";
import { type BlogArticle } from "../server/lib/blog-data";

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
      <div class="px-4 pb-16 md:px-8">
        <div class="mx-auto max-w-3xl prose prose-invert prose-emerald max-w-none
          prose-headings:text-white prose-h2:text-2xl prose-h2:font-bold prose-h2:mt-8 prose-h2:mb-4
          prose-p:text-slate-300 prose-li:text-slate-300 prose-a:text-emerald-400
          prose-strong:text-white prose-code:text-emerald-400">
          ${raw(article.content)}
        </div>
      </div>
      <footer class="px-4 pb-16 md:px-8">
        <div class="mx-auto max-w-3xl">
          <div class="flex flex-wrap gap-2">
            ${article.tags.map((t) => `<span class="rounded-full bg-slate-800 px-3 py-1 text-xs text-slate-400">${t}</span>`).join("")}
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
