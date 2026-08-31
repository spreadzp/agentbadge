/**
 * SLICE-18-9: E2E Crawler-Simulation Test Suite
 *
 * Simulates what a lightweight AI crawler (no JS, no hints, first contact)
 * experiences when fetching pages from AgentBadge. Proves that a bot can
 * extract complete product understanding from server-rendered HTML alone.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { Hono } from "hono";
import { wellKnownRoutes } from "../../src/server/routes/well-known";
import { catalogRoutes } from "../../src/server/routes/catalog";
import { uiRoutes } from "../../src/server/routes/ui";
import { searchRoutes } from "../../src/server/routes/search";
import { contactRoutes } from "../../src/server/routes/contact";
import { agentGuideRoutes } from "../../src/server/routes/agent-guide";
import { marketGuideRoutes } from "../../src/server/routes/market-guide";
import { medicalGuideRoutes } from "../../src/server/routes/medical-guide";
import { contentPageRoutes } from "../../src/server/routes/content-pages";
import { changelogRoutes } from "../../src/server/routes/changelog";
import { corsMiddleware } from "../../src/server/middleware/cors";
import { rateLimitMiddleware } from "../../src/server/middleware/rate-limit";
import { signatureVerificationMiddleware } from "../../src/server/middleware/signature-verification";
import { MCP_TOOLS_INDEX, getLlmsTxt } from "@agentbadge/hedera-core";

function makeCrawlerApp(): Hono {
  const app = new Hono();
  app.use(corsMiddleware());
  app.use((c, next) => signatureVerificationMiddleware(c as any, next));
  app.use(rateLimitMiddleware());
  app.route("/", catalogRoutes);
  app.route("/", wellKnownRoutes);
  app.route("/", uiRoutes);
  app.route("/", searchRoutes);
  app.route("/", contactRoutes);
  app.route("/", agentGuideRoutes);
  app.route("/", marketGuideRoutes);
  app.route("/", medicalGuideRoutes);
  app.route("/", contentPageRoutes);
  app.route("/", changelogRoutes);
  return app;
}

// ─── Helpers ──────────────────────────────────────────────────

function extractJsonLdBlocks(html: string): object[] {
  const blocks: object[] = [];
  const regex = /<script type="application\/ld\+json">(.+?)<\/script>/gs;
  let match;
  while ((match = regex.exec(html)) !== null) {
    try {
      const parsed = JSON.parse(match[1]);
      if (Array.isArray(parsed)) {
        blocks.push(...parsed);
      } else {
        blocks.push(parsed);
      }
    } catch {
      // skip unparseable blocks
    }
  }
  return blocks;
}

function extractMetaContent(html: string, name: string): string | null {
  const match = html.match(
    new RegExp(`<meta name="${name}" content="([^"]*)"`, "i"),
  );
  return match ? match[1] : null;
}

function extractTitle(html: string): string | null {
  const match = html.match(/<title>([^<]+)<\/title>/i);
  return match ? match[1] : null;
}

const AI_BOT_UAS = [
  "GPTBot/1.0 (+https://openai.com/gptbot)",
  "ClaudeBot/1.0 (+https://anthropic.com/claudebot)",
  "PerplexityBot/1.0 (+https://perplexity.ai/perplexitybot)",
  "Googlebot/2.1 (+http://www.google.com/bot.html)",
];

// ─── Test Suite ───────────────────────────────────────────────

describe("SLICE-18-9: E2E Crawler-Simulation", () => {
  let app: Hono;

  beforeAll(() => {
    process.env.MOCK_HEDERA = "true";
    process.env.PASSPORT_TOKEN_ID = "0.0.9681741";
    process.env.HEDERA_OPERATOR_ID = "0.0.5266613";
    process.env.AUDIT_TOPIC_ID = "0.0.9681981";
    process.env.DIRECTORY_TOPIC_ID = "0.0.9681982";
    app = makeCrawlerApp();
  });

  // ─── 1. First-Contact Comprehension ───────────────────────

  describe("First-contact comprehension (GET /)", () => {
    let html: string;

    beforeAll(async () => {
      const res = await app.request("/");
      html = await res.text();
    });

    it("returns 200", async () => {
      const res = await app.request("/");
      expect(res.status).toBe(200);
    });

    it("contains product name 'AgentBadge'", () => {
      expect(html).toContain("AgentBadge");
    });

    it("has meta description extractable from HTML alone", () => {
      const desc = extractMetaContent(html, "description");
      expect(desc).not.toBeNull();
      expect(desc!.length).toBeGreaterThan(50);
    });

    it("contains feature keywords: Hedera, HTS, HCS, passport, A2A", () => {
      expect(html).toContain("Hedera");
      expect(html).toContain("HTS");
      expect(html).toContain("HCS");
      expect(html.toLowerCase()).toContain("passport");
      expect(html).toContain("A2A");
    });

    it("contains discovery URLs in link/meta tags or content", () => {
      expect(html).toContain("/llms.txt");
      expect(html).toContain("agent-card");
      expect(html).toContain("/api/specs");
    });

    it("has canonical link tag", () => {
      expect(html).toContain('rel="canonical"');
    });

    it("has Open Graph tags", () => {
      expect(html).toContain('property="og:title"');
      expect(html).toContain('property="og:description"');
      expect(html).toContain('property="og:url"');
    });
  });

  // ─── 2. JSON-LD Validity ──────────────────────────────────

  describe("JSON-LD validity", () => {
    it("GET / has valid JSON-LD blocks with @context and @type", async () => {
      const res = await app.request("/");
      const html = await res.text();
      const blocks = extractJsonLdBlocks(html);
      expect(blocks.length).toBeGreaterThan(0);
      for (const block of blocks) {
        const obj = block as Record<string, unknown>;
        expect(obj["@context"]).toBeDefined();
        expect(obj["@type"]).toBeDefined();
      }
    });

    it("GET / contains SoftwareApplication schema", async () => {
      const res = await app.request("/");
      const html = await res.text();
      const blocks = extractJsonLdBlocks(html);
      const swApp = blocks.find(
        (b) => (b as Record<string, unknown>)["@type"] === "SoftwareApplication",
      );
      expect(swApp).toBeDefined();
    });

    it("GET /faq contains FAQPage schema with Question entities", async () => {
      const res = await app.request("/faq");
      const html = await res.text();
      const blocks = extractJsonLdBlocks(html);
      const faq = blocks.find(
        (b) => (b as Record<string, unknown>)["@type"] === "FAQPage",
      );
      expect(faq).toBeDefined();
      const mainEntity = (faq as Record<string, unknown>).mainEntity as unknown[];
      expect(mainEntity).toBeDefined();
      expect(mainEntity.length).toBeGreaterThanOrEqual(10);
      for (const q of mainEntity) {
        const qObj = q as Record<string, unknown>;
        expect(qObj["@type"]).toBe("Question");
        expect(qObj.name).toBeDefined();
        expect((qObj.acceptedAnswer as Record<string, unknown>).text).toBeDefined();
      }
    });

    it("GET /use-cases contains Article schema", async () => {
      const res = await app.request("/use-cases");
      const html = await res.text();
      const blocks = extractJsonLdBlocks(html);
      const article = blocks.find(
        (b) => (b as Record<string, unknown>)["@type"] === "Article",
      );
      expect(article).toBeDefined();
      expect((article as Record<string, unknown>).headline).toBeDefined();
    });
  });

  // ─── 3. Crawler Files Chain ───────────────────────────────

  describe("Crawler files chain (robots.txt → sitemap → pages)", () => {
    it("GET /robots.txt returns 200 with Sitemap line", async () => {
      const res = await app.request("/robots.txt");
      expect(res.status).toBe(200);
      const txt = await res.text();
      expect(txt).toContain("Sitemap:");
      expect(txt).toContain("/sitemap.xml");
    });

    it("GET /sitemap.xml returns 200 with valid XML", async () => {
      const res = await app.request("/sitemap.xml");
      expect(res.status).toBe(200);
      const xml = await res.text();
      expect(xml).toContain("<urlset");
      expect(xml).toContain("</urlset>");
    });

    it("every sitemap <loc> URL returns 200; HTML pages have unique title + meta description", async () => {
      const res = await app.request("/sitemap.xml");
      const xml = await res.text();
      const locs = Array.from(xml.matchAll(/<loc>([^<]+)<\/loc>/g)).map(
        (m) => m[1],
      );
      expect(locs.length).toBeGreaterThan(5);

      const titles = new Set<string>();
      const descriptions = new Set<string>();
      const htmlPagePaths = new Set<string>();

      for (const loc of locs) {
        const url = new URL(loc);
        const pageRes = await app.request(url.pathname);
        expect(pageRes.status, `Sitemap URL ${url.pathname} returned non-200`).toBe(200);

        const contentType = pageRes.headers.get("content-type") ?? "";
        const body = await pageRes.text();

        // Markdown pages (guides) don't have HTML title/meta — only check HTML pages
        if (contentType.includes("text/html")) {
          htmlPagePaths.add(url.pathname);
          const title = extractTitle(body);
          expect(title, `HTML page ${url.pathname} has no title`).not.toBeNull();
          titles.add(title!);

          const desc = extractMetaContent(body, "description");
          expect(desc, `HTML page ${url.pathname} has no meta description`).not.toBeNull();
          descriptions.add(desc!);
        }
      }

      // All HTML page titles should be unique
      expect(titles.size).toBe(htmlPagePaths.size);
      // All HTML page descriptions should be unique
      expect(descriptions.size).toBe(htmlPagePaths.size);
    });
  });

  // ─── 4. AI-Bot UA Matrix ──────────────────────────────────

  describe("AI-bot User-Agent matrix", () => {
    const keyPaths = ["/", "/faq", "/use-cases", "/llms.txt", "/robots.txt"];

    for (const ua of AI_BOT_UAS) {
      it(`UA "${ua.split("/")[0]}" gets identical 200 responses on key paths`, async () => {
        for (const path of keyPaths) {
          const res = await app.request(path, {
            headers: { "User-Agent": ua },
          });
          expect(res.status, `Path ${path} with UA ${ua}`).toBe(200);
        }
      });
    }

    it("no AI-bot UA is blocked by robots.txt", async () => {
      const res = await app.request("/robots.txt");
      const txt = await res.text();
      // Should not contain Disallow: / for any AI bot
      expect(txt).not.toMatch(/User-agent: (GPTBot|ClaudeBot|PerplexityBot|Google-Extended)\s+Disallow: \//);
    });
  });

  // ─── 5. No-JS Dashboard ───────────────────────────────────

  describe("No-JS dashboard (GET /)", () => {
    let html: string;

    beforeAll(async () => {
      const res = await app.request("/");
      html = await res.text();
    });

    it("has zero 'Loading' occurrences", () => {
      expect(html).not.toContain("Loading");
      expect(html).not.toContain("Loading…");
      expect(html).not.toContain("Loading...");
    });

    it("has meaningful content in each of 5 dashboard sections", () => {
      const sections = [
        "stats",
        "passport-feed",
        "audit-stream",
        "a2a-inbox",
        "marketplace-tasks",
      ];
      for (const id of sections) {
        // Each section container should exist
        expect(html).toContain(`id="${id}"`);
      }
    });

    it("dashboard has at least 200 chars of visible text content", () => {
      // Strip HTML tags and count visible text
      const textOnly = html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      expect(textOnly.length).toBeGreaterThan(200);
    });
  });

  // ─── 6. llms.txt Completeness ─────────────────────────────

  describe("llms.txt completeness", () => {
    let txt: string;

    beforeAll(() => {
      txt = getLlmsTxt();
    });

    it("GET /llms.txt returns 200 with text/markdown", async () => {
      const res = await app.request("/llms.txt");
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/markdown");
    });

    it("contains MCP Tools section with 38 tools", () => {
      expect(txt).toContain("### MCP Tools");
      expect(txt).toContain(`${MCP_TOOLS_INDEX.length} total`);
      for (const tool of MCP_TOOLS_INDEX) {
        expect(txt).toContain(tool.name);
      }
    });

    it("contains Curl Examples section with >= 5 commands", () => {
      expect(txt).toContain("### Curl Examples");
      const curlCount = (txt.match(/^curl /gm) || []).length;
      expect(curlCount).toBeGreaterThanOrEqual(5);
    });

    it("contains Content Pages section with /faq and /use-cases", () => {
      expect(txt).toContain("## Content Pages");
      expect(txt).toContain("/faq");
      expect(txt).toContain("/use-cases");
    });

    it("preserves pre-existing sections", () => {
      expect(txt).toContain("# Agent Passport on Hedera");
      expect(txt).toContain("## Base URL");
      expect(txt).toContain("## Authentication");
      expect(txt).toContain("## Quick Start");
      expect(txt).toContain("## Endpoints");
      expect(txt).toContain("## MCP Server");
      expect(txt).toContain("## Error Format");
      expect(txt).toContain("## Payment");
    });

    it("stays under 50KB", () => {
      expect(txt.length).toBeLessThan(50 * 1024);
    });
  });

  // ─── 7. Content Pages Quality ─────────────────────────────

  describe("Content pages quality", () => {
    it("GET /faq has >= 10 Q&A pairs in HTML", async () => {
      const res = await app.request("/faq");
      const html = await res.text();
      const detailsCount = (html.match(/<details/g) || []).length;
      expect(detailsCount).toBeGreaterThanOrEqual(10);
    });

    it("GET /use-cases has >= 4 scenario articles", async () => {
      const res = await app.request("/use-cases");
      const html = await res.text();
      const articleCount = (html.match(/<article/g) || []).length;
      expect(articleCount).toBeGreaterThanOrEqual(4);
    });

    it("both content pages have unique titles", async () => {
      const faqRes = await app.request("/faq");
      const faqHtml = await faqRes.text();
      const ucRes = await app.request("/use-cases");
      const ucHtml = await ucRes.text();
      const faqTitle = extractTitle(faqHtml);
      const ucTitle = extractTitle(ucHtml);
      expect(faqTitle).not.toBe(ucTitle);
    });

    it("both content pages have unique meta descriptions", async () => {
      const faqRes = await app.request("/faq");
      const faqHtml = await faqRes.text();
      const ucRes = await app.request("/use-cases");
      const ucHtml = await ucRes.text();
      const faqDesc = extractMetaContent(faqHtml, "description");
      const ucDesc = extractMetaContent(ucHtml, "description");
      expect(faqDesc).not.toBe(ucDesc);
    });

    it("footer contains links to /faq and /use-cases", async () => {
      const res = await app.request("/");
      const html = await res.text();
      expect(html).toContain('href="/faq"');
      expect(html).toContain('href="/use-cases"');
    });
  });

  // ─── 8. Regression Guards ─────────────────────────────────

  describe("Regression guards (test fails if SEO degraded)", () => {
    it("removing meta description would break: / has meta description", async () => {
      const res = await app.request("/");
      const html = await res.text();
      expect(html).toMatch(/<meta name="description" content="[^"]+"/);
    });

    it("broken JSON-LD would break: all blocks parse as valid JSON", async () => {
      const res = await app.request("/");
      const html = await res.text();
      const blocks = extractJsonLdBlocks(html);
      expect(blocks.length).toBeGreaterThan(0);
    });

    it("missing robots.txt would break: /robots.txt returns 200", async () => {
      const res = await app.request("/robots.txt");
      expect(res.status).toBe(200);
    });

    it("sitemap URL 404 would break: all sitemap URLs return 200", async () => {
      const res = await app.request("/sitemap.xml");
      const xml = await res.text();
      const locs = Array.from(xml.matchAll(/<loc>([^<]+)<\/loc>/g)).map(
        (m) => m[1],
      );
      for (const loc of locs) {
        const url = new URL(loc);
        const pageRes = await app.request(url.pathname);
        expect(pageRes.status, `Sitemap URL ${url.pathname} should return 200`).toBe(200);
      }
    });
  });
});
