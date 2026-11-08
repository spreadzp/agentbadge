/**
 * SLICE-206-17 (EPIC-206): AI-crawler nourishment.
 *
 * Contracts:
 * - robots.txt explicitly allows the AI crawler allowlist
 *   (GPTBot, OAI-SearchBot, ChatGPT-User, ClaudeBot, PerplexityBot,
 *   ElevenlabsCrawler/Bot, ExaBot/ExaSearchBot, CCBot, cohere-ai).
 * - ai-sitemap.xml advertises the new onboarding/pricing guides.
 * - traffic-format classifies the new UA families and emits the
 *   "AI crawlers" report section with per-crawler hits + top paths.
 * - llms-full.txt links the new guide pages.
 */

import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { sitemapRoutes } from "../../src/server/routes/well-known/sitemaps";
import {
  classifyUa,
  collectStats,
  aiCrawlerStats,
  aiCrawlerSection,
  formatTextReport,
  type TrafficRow,
} from "../../src/server/lib/report/traffic-format";
import {
  buildLlmsFullTxt,
  type DiscoverySources,
} from "../../src/server/lib/agent-discovery";

const CRAWLERS = [
  "GPTBot",
  "OAI-SearchBot",
  "ChatGPT-User",
  "ClaudeBot",
  "anthropic-ai",
  "PerplexityBot",
  "ElevenlabsCrawler",
  "ElevenlabsBot",
  "ExaBot",
  "ExaSearchBot",
  "CCBot",
  "cohere-ai",
];

describe("GET /robots.txt — AI crawler allowlist", () => {
  it("allows every welcomed AI crawler", async () => {
    const app = new Hono();
    app.route("/", sitemapRoutes);
    const res = await app.request("/robots.txt");
    expect(res.status).toBe(200);
    const body = await res.text();
    for (const ua of CRAWLERS) {
      expect(body).toMatch(
        new RegExp(`User-agent: ${ua.replace(/-/g, "\\-")}\\s*\nAllow: /`),
      );
    }
    // Spam crawlers still blocked.
    expect(body).toContain("User-agent: Bytespider\nDisallow: /");
    // Sitemaps still advertised.
    expect(body).toContain("Sitemap:");
  });
});

describe("GET /ai-sitemap.xml — onboarding resources", () => {
  it("lists the new guide + pricing resources", async () => {
    const app = new Hono();
    app.route("/", sitemapRoutes);
    const res = await app.request("/ai-sitemap.xml");
    const xml = await res.text();
    for (const loc of [
      "/agent-guide/getting-started",
      "/agent-guide/earnings",
      "/agent-guide/post-task",
      "/llms-full.txt",
      "/pricing.json",
      "/pricing.md",
    ]) {
      expect(xml).toContain(loc);
    }
  });
});

describe("llms-full.txt — guide links", () => {
  it("links getting-started, earnings, post-task, success story", () => {
    const src: DiscoverySources = {
      baseUrl: "https://agentbadge.xyz",
      authSection: "## Auth\n",
      articles: [],
      faqEntries: [],
      tiers: [],
      appRoutes: [],
      skus: [],
    };
    const full = buildLlmsFullTxt(src);
    expect(full).toContain("/agent-guide/getting-started");
    expect(full).toContain("/agent-guide/earnings");
    expect(full).toContain("/agent-guide/post-task");
    expect(full).toContain("/agent-guide/success-stories/arc-testnet-board");
    expect(full).toContain("/pricing.json");
  });
});

const row = (ua: string, path = "/llms.txt"): TrafficRow => ({
  payload: { method: "GET", path, status: 200, ua },
  createdAt: new Date().toISOString(),
});

describe("traffic-report — AI crawler classification", () => {
  it("classifies the new UA families", () => {
    expect(classifyUa("ElevenlabsBot/1.0")).toBe("ElevenLabs");
    expect(classifyUa("ElevenlabsCrawler/1.0")).toBe("ElevenLabs");
    expect(classifyUa("ExaSearchBot/1.0")).toBe("Exa");
    expect(classifyUa("OAI-SearchBot/1.0")).toBe("GPTBot");
    expect(classifyUa("ChatGPT-User/2.0")).toBe("GPTBot");
    expect(classifyUa("ClaudeBot/1.0")).toBe("ClaudeBot");
  });

  it("aiCrawlerStats aggregates per-crawler hits + top paths", () => {
    const rows = [
      row("GPTBot/1.2", "/llms.txt"),
      row("GPTBot/1.2", "/pricing.json"),
      row("ClaudeBot/1.0", "/llms-full.txt"),
      row("Mozilla/5.0", "/"), // not an AI crawler
    ];
    const stats = aiCrawlerStats(rows);
    expect(stats.length).toBe(2);
    expect(stats[0].crawler).toContain("OpenAI");
    expect(stats[0].hits).toBe(2);
    expect(stats[0].topPaths[0][0]).toBe("/llms.txt");
    expect(stats[1].crawler).toContain("Anthropic");
  });

  it("report sections include the AI crawler block", () => {
    const stats = collectStats([row("GPTBot", "/llms.txt")], 24);
    expect(stats.aiCrawlerBody).toContain("OpenAI");
    const text = formatTextReport(stats);
    expect(text).toContain("AI crawlers");
    const empty = aiCrawlerSection([]);
    expect(empty).toContain("no AI-crawler hits");
  });
});
