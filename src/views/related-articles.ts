import type { BlogArticle } from "../server/lib/blog-data";

export function RelatedArticles(
  articles: Pick<BlogArticle, "slug" | "title" | "description" | "date" | "readingTime">[],
): string {
  if (articles.length === 0) return "";

  const cards = articles
    .map(
      (article) => `
      <a href="/blog/${article.slug}" class="block rounded-lg border border-slate-800 bg-slate-900/50 p-4 transition-colors hover:border-emerald-500/50">
        <h3 class="text-sm font-semibold text-slate-100">${article.title}</h3>
        <p class="mt-1 text-xs text-slate-400 line-clamp-2">${article.description}</p>
        <div class="mt-2 flex items-center gap-3 text-xs text-slate-500">
          <time>${article.date}</time>
          <span>·</span>
          <span>${article.readingTime}</span>
        </div>
      </a>`,
    )
    .join("");

  return `
    <section class="mt-8">
      <h2 class="text-sm font-semibold text-slate-200">Related Articles</h2>
      <div class="mt-4 grid gap-3 sm:grid-cols-2">
        ${cards}
      </div>
    </section>
  `;
}
