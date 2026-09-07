import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { LandingLayout } from "../../views/landing/layout";
import { BlogListPage } from "../../views/blog-list";
import { BlogArticlePage } from "../../views/blog-article";
import { BLOG_ARTICLES, generateBlogIndexMarkdown, paginateArticles, getRelatedArticles, getTagCounts, filterByTag } from "../lib/blog-data";
import { PageMeta as PageMetaRegistry } from "../lib/page-meta";
import { pageCoreSchemas, blogLd, itemListLd, breadcrumbFor } from "../lib/json-ld";
import { BASE_URL } from "../lib/page-meta";

export const blogRoutes = new Hono();

blogRoutes.get(
  "/blog",
  describeRoute({
    tags: ["Blog"],
    summary: "Blog listing page",
    description: "List of published blog articles.",
    responses: { 200: { description: "HTML blog listing page" } },
  }),
  (c) => {
    const meta = PageMetaRegistry["/blog"] ?? {
      title: "Blog",
      description: "Deep dives into agent-ready infrastructure, MCP protocol, x402 payments.",
      path: "/blog",
    };
    const pageParam = c.req.query("page");
    const page = pageParam ? parseInt(pageParam, 10) : 1;
    const tagParam = c.req.query("tag");
    const tagCounts = getTagCounts(BLOG_ARTICLES);
    const filteredArticles = tagParam ? filterByTag(BLOG_ARTICLES, tagParam) : BLOG_ARTICLES;
    const { items, meta: paginationMeta } = paginateArticles(filteredArticles, page);

    const schemas = [
      ...pageCoreSchemas(),
      blogLd({
        description: meta.description,
        path: tagParam ? `/blog?tag=${tagParam}` : "/blog",
        articles: items,
      }),
      itemListLd(items),
      breadcrumbFor("/blog", "Blog"),
    ];
    const content = BlogListPage(items, paginationMeta, { tagCounts, activeTag: tagParam }).toString();
    const canonicalPath = tagParam
      ? `/blog?tag=${encodeURIComponent(tagParam)}`
      : paginationMeta.currentPage > 1
        ? `/blog?page=${paginationMeta.currentPage}`
        : "/blog";
    const prevRel = paginationMeta.hasPrev
      ? `${BASE_URL}${paginationMeta.currentPage === 2 ? "/blog" : `/blog?page=${paginationMeta.currentPage - 1}`}`
      : undefined;
    const nextRel = paginationMeta.hasNext
      ? `${BASE_URL}/blog?page=${paginationMeta.currentPage + 1}`
      : undefined;
    const pageHtml = LandingLayout(content, undefined, {
      ...meta,
      path: canonicalPath,
      rssUrl: "/blog/rss.xml",
      markdownUrl: "/blog/index.md",
      prevRel,
      nextRel,
    }, schemas);
    return c.html(pageHtml);
  },
);

blogRoutes.get(
  "/blog/rss.xml",
  describeRoute({
    tags: ["Blog"],
    summary: "RSS feed",
    description: "RSS 2.0 feed for blog articles.",
    responses: { 200: { description: "RSS XML feed" } },
  }),
  (c) => {
    const items = BLOG_ARTICLES.map(
      (a) => `    <item>
      <title><![CDATA[${a.title}]]></title>
      <link>${BASE_URL}/blog/${a.slug}</link>
      <guid isPermaLink="true">${BASE_URL}/blog/${a.slug}</guid>
      <description><![CDATA[${a.description}]]></description>
      <pubDate>${new Date(a.date).toUTCString()}</pubDate>
      <author>${a.author}</author>
    </item>`,
    ).join("\n");

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>AgentBadge Blog</title>
    <link>${BASE_URL}/blog</link>
    <description>Deep dives into agent-ready infrastructure, MCP protocol, x402 payments, and the agentic web.</description>
    <language>en-us</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
${items}
  </channel>
</rss>`;

    c.header("Content-Type", "application/rss+xml; charset=UTF-8");
    return c.body(xml);
  },
);

blogRoutes.get(
  "/blog/index.md",
  describeRoute({
    tags: ["Blog"],
    summary: "Blog index as Markdown",
    description: "Machine-readable Markdown index of all blog articles with HTML and MD URLs.",
    responses: { 200: { description: "Markdown blog index" } },
  }),
  (c) => {
    c.header("Content-Type", "text/markdown; charset=UTF-8");
    return c.body(generateBlogIndexMarkdown());
  },
);

blogRoutes.get(
  "/blog/:slug{[^.]+\\.md$}",
  describeRoute({
    tags: ["Blog"],
    summary: "Blog article as Markdown",
    description: "Machine-readable Markdown representation of a blog article.",
    responses: { 200: { description: "Markdown article" }, 404: { description: "Not found" } },
  }),
  (c) => {
    const slug = c.req.param("slug").replace(/\.md$/, "");
    const article = BLOG_ARTICLES.find((a) => a.slug === slug);
    if (!article || !article.markdown) {
      return c.text("Article not found", 404);
    }
    c.header("Content-Type", "text/markdown; charset=UTF-8");
    return c.body(article.markdown);
  },
);

blogRoutes.get(
  "/blog/:slug",
  describeRoute({
    tags: ["Blog"],
    summary: "Blog article page",
    description: "Individual blog article by slug.",
    responses: { 200: { description: "HTML article page" }, 404: { description: "Article not found" } },
  }),
  (c) => {
    const slug = c.req.param("slug");
    const article = BLOG_ARTICLES.find((a) => a.slug === slug);
    if (!article) {
      return c.text("Article not found", 404);
    }

    const meta = {
      title: article.title,
      description: article.description,
      path: `/blog/${article.slug}`,
      ogType: "article",
      articleAuthor: article.author,
      articlePublishedTime: article.date,
      articleModifiedTime: article.dateModified ?? article.date,
      ...(article.ogImage ? { ogImage: `${BASE_URL}${article.ogImage}` } : {}),
      ...(article.markdown ? { markdownUrl: `/blog/${article.slug}.md` } : {}),
    };
    const schemas = [
      ...pageCoreSchemas(),
      {
        "@context": "https://schema.org",
        "@type": "Article",
        headline: article.title,
        description: article.shortAnswer ?? article.description,
        datePublished: article.date,
        dateModified: article.dateModified ?? article.date,
        author: {
          "@type": "Organization",
          name: article.author,
        },
        publisher: {
          "@type": "Organization",
          name: "AgentBadge",
          url: BASE_URL,
        },
        mainEntityOfPage: {
          "@type": "WebPage",
          "@id": `${BASE_URL}/blog/${article.slug}`,
        },
      },
      breadcrumbFor(`/blog/${article.slug}`, article.title),
    ];
    const relatedArticles = getRelatedArticles(article, BLOG_ARTICLES);
    const content = BlogArticlePage(article, relatedArticles).toString();
    const pageHtml = LandingLayout(content, undefined, meta, schemas);
    return c.html(pageHtml);
  },
);

