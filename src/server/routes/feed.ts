/**
 * Platform feed route — SLICE-47-12, rebuilt SLICE-81-3, SLICE-206-14.
 *
 * /feed      — RSS 2.0: blog articles + capability announcements
 *              (<category>capability</category>).
 * /feed.json — JSON Feed 1.1 with typed capability items
 *              {_type, _endpoint, _method, _price, _added_at}.
 * Directory/marketplace feeds live in feed-directory.ts (SLICE-123).
 * Deterministic: no request-time timestamps, dates from blog-data
 * and CAPABILITY_CHANGELOG.
 */
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { BASE_URL, SITE_NAME } from "../lib/page-meta";
import { BLOG_ARTICLES } from "../lib/blog-data";
import {
  CAPABILITY_CHANGELOG,
  capabilityToFeedItem,
  capabilityToRssItem,
} from "../lib/capability-feed";

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
  (_c) => {
    const sorted = [...BLOG_ARTICLES].sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
    );
    const lastBuildDate = new Date(sorted[0].date).toUTCString();

    // SLICE-206-14: capability announcements sit beside articles —
    // <category>capability</category> is the machine filter hook.
    const itemsXml = [
      ...sorted.map(articleToRssItem),
      ...CAPABILITY_CHANGELOG.map((e) => capabilityToRssItem(e, BASE_URL)),
    ].join("\n");

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

// ─── /feed.json (JSON Feed 1.1) — SLICE-206-14 ─────────────────
// Articles + typed capability entries — the machine-readable feed.

feedRoutes.get(
  "/feed.json",
  describeRoute({
    tags: ["Discovery"],
    summary: "Platform feed — articles + capability announcements",
    description:
      "JSON Feed 1.1: blog articles plus machine-readable capability " +
      "entries {_type:'capability', _endpoint, _method, _price, " +
      "_added_at} for new endpoints, skills and price changes.",
    responses: {
      200: {
        description: "JSON Feed 1.1",
        content: { "application/json": {} },
      },
    },
  }),
  () => {
    const articleItems = [...BLOG_ARTICLES]
      .sort(
        (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
      )
      .map((article) => ({
        id: `${BASE_URL}/blog/${article.slug}`,
        url: `${BASE_URL}/blog/${article.slug}`,
        title: article.title,
        content_text: article.description,
        date_published: new Date(article.date).toISOString(),
        tags: ["article"],
        _type: "article",
      }));
    const capabilityItems = CAPABILITY_CHANGELOG.map(capabilityToFeedItem);
    const items = [...articleItems, ...capabilityItems].sort(
      (a, b) =>
        new Date(b.date_published).getTime() -
        new Date(a.date_published).getTime(),
    );

    const feed = {
      version: "https://jsonfeed.org/version/1.1",
      title: "AgentBadge — Platform Feed",
      description:
        "Articles and machine-readable capability announcements " +
        "(new endpoints, skills, price changes).",
      home_page_url: BASE_URL,
      feed_url: `${BASE_URL}/feed.json`,
      items,
    };
    return new Response(JSON.stringify(feed, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "public, max-age=300",
      },
    });
  },
);

