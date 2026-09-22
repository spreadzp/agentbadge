import { SITE_NAME, BASE_URL } from "../page-meta";
import type { BlogArticle } from "../blog-data";
import { SCHEMA_CONTEXT } from "./shared";

// ─── Blog Schema (SLICE-60-4) ───────────────────────────────

export function blogLd(opts: {
  description: string;
  path: string;
  articles: BlogArticle[];
}): object {
  return {
    "@context": SCHEMA_CONTEXT,
    "@type": "Blog",
    name: "AgentBadge Blog",
    description: opts.description,
    url: `${BASE_URL}${opts.path}`,
    publisher: {
      "@type": "Organization",
      name: SITE_NAME,
      url: BASE_URL,
    },
    blogPost: opts.articles.map((a) => ({
      "@type": "BlogPosting",
      headline: a.title,
      url: `${BASE_URL}/blog/${a.slug}`,
      datePublished: a.date,
      author: {
        "@type": "Organization",
        name: a.author,
      },
    })),
  };
}

export function itemListLd(articles: BlogArticle[]): object {
  return {
    "@context": SCHEMA_CONTEXT,
    "@type": "ItemList",
    itemListElement: articles.map((a, i) => ({
      "@type": "ListItem",
      position: i + 1,
      url: `${BASE_URL}/blog/${a.slug}`,
      name: a.title,
    })),
  };
}
