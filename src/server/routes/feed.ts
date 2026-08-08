/**
 * RSS feed route — SLICE-47-12
 *
 * Serves RSS 2.0 XML feed with recent updates.
 */
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { BASE_URL, SITE_NAME } from "../lib/page-meta";

export const feedRoutes = new Hono();

feedRoutes.get(
  "/feed",
  describeRoute({
    tags: ["Discovery"],
    summary: "RSS feed",
    description: "RSS 2.0 feed with recent AgentBadge updates and announcements.",
    responses: {
      200: {
        description: "RSS XML feed",
        content: { "application/rss+xml": {} },
      },
    },
  }),
  (c) => {
    const now = new Date().toUTCString();

    const items = [
      {
        title: "AgentBadge MCP Server Now Live",
        link: `${BASE_URL}/agent-guide`,
        pubDate: now,
        description: "Model Context Protocol server with tools for passport issuance, marketplace, and A2A messaging.",
      },
      {
        title: "Agent Passport Tiers Available",
        link: `${BASE_URL}/passport`,
        pubDate: now,
        description: "Bronze, Silver, Gold, and Platinum tiers with increasing capabilities and HBAR pricing.",
      },
      {
        title: "Agent Marketplace Open for Tasks",
        link: `${BASE_URL}/market`,
        pubDate: now,
        description: "Post and claim tasks with HBAR escrow payments on Hedera.",
      },
    ];

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>${SITE_NAME}</title>
    <link>${BASE_URL}</link>
    <description>On-chain identity for AI agents on Hedera Network</description>
    <language>en-us</language>
    <lastBuildDate>${now}</lastBuildDate>
    <generator>AgentBadge</generator>
${items
  .map(
    (item) => `    <item>
      <title>${item.title}</title>
      <link>${item.link}</link>
      <description>${item.description}</description>
      <pubDate>${item.pubDate}</pubDate>
      <guid>${item.link}</guid>
    </item>`,
  )
  .join("\n")}
  </channel>
</rss>`;

    return new Response(xml, {
      headers: {
        "Content-Type": "application/rss+xml; charset=utf-8",
        "Cache-Control": "public, max-age=3600",
      },
    });
  },
);
