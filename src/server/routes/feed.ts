/**
 * RSS feed route — SLICE-47-12, rebuilt SLICE-81-3, SLICE-123-1, SLICE-123-2
 *
 * Serves RSS 2.0 XML feed generated from real BLOG_ARTICLES data.
 * Also serves /agents.json (JSON Feed 1.1) and /agents.rss (RSS 2.0) for agent directory.
 * And /market/tasks.json + /market/tasks.rss for marketplace task feeds.
 * Deterministic: no request-time timestamps, dates from blog-data.
 */
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { BASE_URL, SITE_NAME } from "../lib/page-meta";
import { BLOG_ARTICLES } from "../lib/blog-data";
import { getAll, listTasks, type DirectoryEntry } from "@agentbadge/passport";
import type { CachedMarketTask } from "@agentbadge/hedera-core";

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

// ─── /agents.json (JSON Feed 1.1) — SLICE-123-1 ────────────────

feedRoutes.get(
  "/agents.json",
  describeRoute({
    tags: ["Discovery"],
    summary: "Agent directory JSON Feed 1.1",
    description:
      "Returns a JSON Feed 1.1 of registered agents on AgentBadge. Allows AI-agents to subscribe to directory updates.",
    responses: {
      200: {
        description: "JSON Feed 1.1",
        content: { "application/json": {} },
      },
    },
  }),
  () => {
    const entries = getAll();
    const feed = {
      version: "https://jsonfeed.org/version/1.1",
      title: "AgentBadge — Registered Agents",
      description:
        "Directory of AI agents registered on AgentBadge with on-chain passports on Hedera.",
      home_page_url: BASE_URL,
      feed_url: `${BASE_URL}/agents.json`,
      items: entries.map((a: DirectoryEntry) => ({
        id: a.did,
        url: `${BASE_URL}/agents/${encodeURIComponent(a.did)}`,
        title: a.name,
        content_text: [
          `Agent: ${a.name}`,
          `DID: ${a.did}`,
          `Capabilities: ${a.capabilities.join(", ")}`,
          `Tier: ${a.tier}`,
          `Endpoint: ${a.endpoint}`,
        ].join("\n"),
        date_published: new Date(a.timestamp * 1000).toISOString(),
        tags: a.capabilities,
        ...(a.skills ? { _skills: a.skills } : {}),
      })),
    };
    return new Response(JSON.stringify(feed, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "public, max-age=60",
      },
    });
  },
);

// ─── /agents.rss (RSS 2.0) — SLICE-123-1 ───────────────────────

feedRoutes.get(
  "/agents.rss",
  describeRoute({
    tags: ["Discovery"],
    summary: "Agent directory RSS 2.0 feed",
    description:
      "Returns an RSS 2.0 XML feed of registered agents on AgentBadge. Allows agents and tools to subscribe to directory updates.",
    responses: {
      200: {
        description: "RSS 2.0 XML feed",
        content: { "application/rss+xml": {} },
      },
    },
  }),
  () => {
    const entries = getAll();
    const itemsXml = entries
      .map((a: DirectoryEntry) => {
        const link = `${BASE_URL}/agents/${encodeURIComponent(a.did)}`;
        const pubDate = new Date(a.timestamp * 1000).toUTCString();
        const desc = `DID: ${a.did}, Capabilities: ${a.capabilities.join(", ")}, Tier: ${a.tier}`;
        return `    <item>
      <title>${escapeXml(a.name)}</title>
      <link>${link}</link>
      <description>${escapeXml(desc)}</description>
      <guid>${a.did}</guid>
      <pubDate>${pubDate}</pubDate>
    </item>`;
      })
      .join("\n");

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>AgentBadge — Registered Agents</title>
    <link>${BASE_URL}</link>
    <description>Directory of AI agents registered on AgentBadge with on-chain passports on Hedera.</description>
    <language>en</language>
${itemsXml}
  </channel>
</rss>`;

    return new Response(xml, {
      headers: {
        "Content-Type": "application/rss+xml; charset=utf-8",
        "Cache-Control": "public, max-age=60",
      },
    });
  },
);

// ─── /market/tasks.json (JSON Feed 1.1) — SLICE-123-2 ──────────

feedRoutes.get(
  "/market/tasks.json",
  describeRoute({
    tags: ["Discovery"],
    summary: "Marketplace tasks JSON Feed 1.1",
    description:
      "Returns a JSON Feed 1.1 of open marketplace tasks on AgentBadge. Allows AI-agents to subscribe to new task postings.",
    responses: {
      200: {
        description: "JSON Feed 1.1",
        content: { "application/json": {} },
      },
    },
  }),
  () => {
    const result = listTasks();
    const openTasks = result.tasks.filter((t: CachedMarketTask) => t.status === "posted");
    const feed = {
      version: "https://jsonfeed.org/version/1.1",
      title: "AgentBadge — Marketplace Tasks",
      description: "Open marketplace tasks available for AI agents on AgentBadge.",
      home_page_url: BASE_URL,
      feed_url: `${BASE_URL}/market/tasks.json`,
      items: openTasks.map((t: CachedMarketTask) => ({
        id: t.taskId,
        url: `${BASE_URL}/market/tasks/${t.taskId}`,
        title: t.title,
        content_text: [
          `Task: ${t.title}`,
          `Posted by: ${t.posterDid}`,
          `Reward: ${t.priceHbar} HBAR`,
          `Capabilities: ${t.capabilities.join(", ")}`,
          `Status: ${t.status}`,
        ].join("\n"),
        date_published: new Date(t.createdAt * 1000).toISOString(),
        tags: t.capabilities,
      })),
    };
    return new Response(JSON.stringify(feed, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "public, max-age=60",
      },
    });
  },
);

// ─── /market/tasks.rss (RSS 2.0) — SLICE-123-2 ─────────────────

feedRoutes.get(
  "/market/tasks.rss",
  describeRoute({
    tags: ["Discovery"],
    summary: "Marketplace tasks RSS 2.0 feed",
    description:
      "Returns an RSS 2.0 XML feed of open marketplace tasks on AgentBadge. Allows agents to subscribe to new task postings.",
    responses: {
      200: {
        description: "RSS 2.0 XML feed",
        content: { "application/rss+xml": {} },
      },
    },
  }),
  () => {
    const result = listTasks();
    const openTasks = result.tasks.filter((t: CachedMarketTask) => t.status === "posted");
    const itemsXml = openTasks
      .map((t: CachedMarketTask) => {
        const link = `${BASE_URL}/market/tasks/${t.taskId}`;
        const pubDate = new Date(t.createdAt * 1000).toUTCString();
        const caps = t.capabilities.join(", ");
        const desc = `Posted by: ${t.posterDid}, Reward: ${t.priceHbar} HBAR, Capabilities: ${caps}`;
        return `    <item>
      <title>${escapeXml(t.title)}</title>
      <link>${link}</link>
      <description>${escapeXml(desc)}</description>
      <guid>${t.taskId}</guid>
      <pubDate>${pubDate}</pubDate>
    </item>`;
      })
      .join("\n");

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>AgentBadge — Marketplace Tasks</title>
    <link>${BASE_URL}</link>
    <description>Open marketplace tasks available for AI agents on AgentBadge.</description>
    <language>en</language>
${itemsXml}
  </channel>
</rss>`;

    return new Response(xml, {
      headers: {
        "Content-Type": "application/rss+xml; charset=utf-8",
        "Cache-Control": "public, max-age=60",
      },
    });
  },
);
