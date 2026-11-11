import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { LandingLayout } from "../../views/landing/layout";
import { BlogListPage } from "../../views/blog-list";
import { BlogArticlePage } from "../../views/blog-article";
import {
  BLOG_ARTICLES,
  generateBlogIndexMarkdown,
  paginateArticles,
  getRelatedArticles,
  getTagCounts,
  filterByTag,
  getChannelCounts,
  filterByChannel,
} from "../lib/blog-data";
import { toKnowledgeObject } from "../lib/blog/knowledge-object";
import { PageMeta as PageMetaRegistry } from "../lib/page-meta";
import { pageCoreSchemas, blogLd, itemListLd, breadcrumbFor } from "../lib/json-ld";
import { BASE_URL } from "../lib/page-meta";
import { agentJsonRequests } from "../metrics/metrics";
import { classifyUserAgent } from "../lib/ua-classify";

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
    const baseMeta = PageMetaRegistry["/blog"] ?? {
      title: "Blog",
      description: "Deep dives into agent-ready infrastructure, MCP protocol, x402 payments.",
      path: "/blog",
    };
    const pageParam = c.req.query("page");
    const page = pageParam ? parseInt(pageParam, 10) : 1;
    const tagParam = c.req.query("tag");
    const channelParam = c.req.query("channel");
    const tagCounts = getTagCounts(BLOG_ARTICLES);
    const channelCounts = getChannelCounts(BLOG_ARTICLES);
    // SLICE-217-14: newest-first in every view — array order is curated, not chronological.
    const filteredArticles = (
      tagParam ? filterByTag(BLOG_ARTICLES, tagParam)
      : channelParam ? filterByChannel(BLOG_ARTICLES, channelParam)
      : BLOG_ARTICLES
    ).slice().sort((a, b) => b.date.localeCompare(a.date));
    const { items, meta: paginationMeta } = paginateArticles(filteredArticles, page);

    // SLICE-217-14: rubric pages get their own meta — name + count (agents read <title> as the answer).
    const rubricLabel = channelParam
      ? (channelCounts.find((ch) => ch.key === channelParam)?.label ?? channelParam)
      : tagParam
        ? `#${tagParam}`
        : undefined;
    const meta = rubricLabel
      ? {
          ...baseMeta,
          title: `${rubricLabel} — ${filteredArticles.length} articles | AgentBadge Blog`,
          description: `${filteredArticles.length} AgentBadge articles in the “${rubricLabel}” rubric — agent readiness, x402 payments, Arc.`,
        }
      : baseMeta;

    const schemas = [
      ...pageCoreSchemas(),
      blogLd({
        description: meta.description,
        path: tagParam ? `/blog?tag=${tagParam}` : channelParam ? `/blog?channel=${channelParam}` : "/blog",
        articles: items,
      }),
      itemListLd(items),
      breadcrumbFor("/blog", "Blog"),
    ];
    const content = BlogListPage(items, paginationMeta, {
      tagCounts,
      channels: channelCounts,
      activeTag: tagParam,
      activeChannel: channelParam,
    }).toString();
    const canonicalPath = tagParam
      ? `/blog?tag=${encodeURIComponent(tagParam)}`
      : channelParam
        ? `/blog?channel=${encodeURIComponent(channelParam)}`
        : paginationMeta.currentPage > 1
        ? `/blog?page=${paginationMeta.currentPage}`
        : "/blog";
    // SLICE-217-14: rel=prev/next keep the active rubric filter too —
    // crawlers follow these links and must stay inside ?channel=/?tag=.
    const pageUrl = (p: number): string => {
      const q = new URLSearchParams();
      if (channelParam) q.set("channel", channelParam);
      if (tagParam) q.set("tag", tagParam);
      if (p > 1) q.set("page", String(p));
      const qs = q.toString();
      return `/blog${qs ? `?${qs}` : ""}`;
    };
    const prevRel = paginationMeta.hasPrev
      ? `${BASE_URL}${pageUrl(paginationMeta.currentPage - 1)}`
      : undefined;
    const nextRel = paginationMeta.hasNext
      ? `${BASE_URL}${pageUrl(paginationMeta.currentPage + 1)}`
      : undefined;
    const pageHtml = LandingLayout(
      content,
      undefined,
      {
        ...meta,
        path: canonicalPath,
        rssUrl: "/blog/rss.xml",
        markdownUrl: "/blog/index.md",
        prevRel,
        nextRel,
      },
      schemas,
    );
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

// SLICE-201-5 (EPIC-201): Content Knowledge Object v1 — the agent-readable
// JSON twin of an article, validatable against /schemas/content/v1.json.
blogRoutes.get(
  "/blog/:slug{[^.]+\\.json$}",
  describeRoute({
    tags: ["Blog"],
    summary: "Blog article as Knowledge Object",
    description:
      "Machine-readable Content Knowledge Object v1 for a blog article (status, topics, concepts, rules, capabilities, actions, qa, claims, canonical, dates, markdownUrl). Schema: /schemas/content/v1.json",
    responses: {
      200: { description: "Content Knowledge Object" },
      404: { description: "Not found" },
    },
  }),
  (c) => {
    const slug = c.req.param("slug").replace(/\.json$/, "");
    const article = BLOG_ARTICLES.find((a) => a.slug === slug);
    if (!article) {
      return c.json({ error: "Article not found" }, 404);
    }
    // SLICE-201-13: consumption signal — D-201-19, never report as "agents used".
    agentJsonRequests.inc({
      slug,
      ua_class: classifyUserAgent(c.req.header("user-agent")),
    });
    return c.json(toKnowledgeObject(article));
  },
);

blogRoutes.get(
  "/blog/:slug",
  describeRoute({
    tags: ["Blog"],
    summary: "Blog article page",
    description: "Individual blog article by slug.",
    responses: {
      200: { description: "HTML article page" },
      404: { description: "Article not found" },
    },
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
      ...(article.canonical ? { canonical: article.canonical } : {}),
      ...(article.ogImage ? { ogImage: `${BASE_URL}${article.ogImage}` } : {}),
      ...(article.markdown ? { markdownUrl: `/blog/${article.slug}.md` } : {}),
      jsonUrl: `/blog/${article.slug}.json`,
    };
    const schemas = [
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
    const relatedArticles = getRelatedArticles(article, BLOG_ARTICLES);
    const content = BlogArticlePage(article, relatedArticles).toString();
    const pageHtml = LandingLayout(content, undefined, meta, schemas);
    return c.html(pageHtml);
  },
);
