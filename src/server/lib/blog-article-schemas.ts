/**
 * JSON-LD schemas for a single blog article page (TechArticle + FAQPage +
 * breadcrumb). Extracted from routes/pages/blog.ts under the 300-line cap.
 */
import type { BlogArticle } from "./blog-data";
import { pageCoreSchemas, breadcrumbFor } from "./json-ld";
import { toKnowledgeObject } from "./blog/knowledge-object";
import { BASE_URL } from "./page-meta";

export function articlePageSchemas(article: BlogArticle): object[] {
  return [
    ...pageCoreSchemas(),
    {
      "@context": "https://schema.org",
      "@type": "TechArticle",
      headline: article.title,
      description: article.shortAnswer ?? article.description,
      url: `${BASE_URL}/blog/${article.slug}`,
      datePublished: article.date,
      dateModified: article.dateModified ?? article.date,
      author: {
        "@type": "Person",
        name: article.author,
      },
      image: article.ogImage ? `${BASE_URL}${article.ogImage}` : `${BASE_URL}/favicon.svg`,
      publisher: {
        "@type": "Organization",
        name: "AgentBadge",
        url: BASE_URL,
        logo: {
          "@type": "ImageObject",
          url: `${BASE_URL}/favicon.svg`,
        },
      },
      mainEntityOfPage: {
        "@type": "WebPage",
        "@id": `${BASE_URL}/blog/${article.slug}`,
      },
    },
    // SLICE-201-11: FAQPage from the same qa[] as the visible Q&A block (SSOT).
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: toKnowledgeObject(article).qa.map((q) => ({
        "@type": "Question",
        name: q.question,
        acceptedAnswer: { "@type": "Answer", text: q.answer },
      })),
    },
    breadcrumbFor(`/blog/${article.slug}`, article.title),
  ];
}
