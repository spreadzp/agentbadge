/**
 * RSS feed route — SLICE-47-12, rebuilt SLICE-81-3
 *
 * Serves RSS 2.0 XML feed generated from real BLOG_ARTICLES data.
 * Deterministic: no request-time timestamps, dates from blog-data.
 */
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { BASE_URL, SITE_NAME } from "../lib/page-meta";
import { BLOG_ARTICLES } from "../lib/blog-data";

export const feedRoutes = new Hono();

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function articleToRssItem(article: (typeof BLOG_ARTICLES)[number]): string {
  const link = `${BASE_URL}/blog/${article.slug}`;
  const pubDate = new Date(article.date).toUTCString();
  return `    <item>
      <title>${escapeXml(article.title)}</title>
      <link>${link}</link>
      <description>${escapeXml(article.description)}</description>
      <pubDate>${pubDate}</pubDate>
      <guid>${link}</guid>
    </item>`;
}

feedRoutes.get(
  "/feed",
  describeRoute({
    tags: ["Discovery"],
    summary: "RSS feed",
    description: "RSS 2.0 feed with recent AgentBadge blog articles.",
    responses: {
      200: {
        description: "RSS XML feed",
        content: { "application/rss+xml": {} },
      },
    },
  }),
  (c) => {
    const sorted = [...BLOG_ARTICLES].sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
    );
    const lastBuildDate = new Date(sorted[0].date).toUTCString();

    const itemsXml = sorted.map(articleToRssItem).join("\n");

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>${SITE_NAME}</title>
    <link>${BASE_URL}</link>
    <description>On-chain identity for AI agents on Hedera Network</description>
    <language>en-us</language>
    <lastBuildDate>${lastBuildDate}</lastBuildDate>
    <generator>AgentBadge</generator>
${itemsXml}
  </channel>
</rss>`;

    return new Response(xml, {
      headers: {
        "Content-Type": "application/rss+xml; charset=utf-8",
        "Content-Length": new TextEncoder().encode(xml).length.toString(),
        "Cache-Control": "public, max-age=3600",
      },
    });
  },
);
