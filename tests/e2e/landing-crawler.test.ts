import { describe, it, expect, beforeAll } from "vitest";
import { Hono } from "hono";
import { setupMockEnv, makeTestApp } from "./helpers";
import { landingRoutes } from "../../src/server/routes/landing";
import { wellKnownRoutes } from "../../src/server/routes/well-known";
import { uiRoutes } from "../../src/server/routes/ui";
import type { Hono as HonoType } from "hono";

/**
 * SLICE-19-14: E2E crawler-simulation test
 *
 * Simulates a search engine / AI bot crawling the landing page:
 * 1. Fetches robots.txt → finds sitemap URL
 * 2. Fetches sitemap.xml → finds /
 * 3. Fetches / with various bot User-Agents
 * 4. Extracts product name, description, features, CTAs, JSON-LD
 * 5. All content is SSR (no JS needed)
 */
function makeCrawlerTestApp(): HonoType {
  const app = new Hono();
  app.route("/", wellKnownRoutes);
  app.route("/", landingRoutes);
  return app;
}

describe("SLICE-19-14: E2E crawler-simulation", () => {
  let app: HonoType;

  beforeAll(() => {
    setupMockEnv();
    app = makeCrawlerTestApp();
  });

  // ─── Crawler files chain: robots.txt → sitemap → / ────────
  describe("Crawler files chain", () => {
    it("GET /robots.txt returns 200 with text/plain", async () => {
      const res = await app.request("/robots.txt");
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/plain");
    });

    it("robots.txt contains Sitemap directive", async () => {
      const res = await app.request("/robots.txt");
      const text = await res.text();
      expect(text).toMatch(/Sitemap:\s+.*\/sitemap\.xml/i);
    });

    it("robots.txt allows major AI bots", async () => {
      const res = await app.request("/robots.txt");
      const text = await res.text();
      expect(text).toContain("GPTBot");
      expect(text).toContain("ClaudeBot");
      expect(text).toContain("PerplexityBot");
    });

    it("GET /sitemap.xml returns 200 with XML", async () => {
      const res = await app.request("/sitemap.xml");
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("xml");
    });

    it("sitemap.xml contains / URL", async () => {
      const res = await app.request("/sitemap.xml");
      const xml = await res.text();
      expect(xml).toContain("<loc>");
      expect(xml).toContain("/");
    });
  });

  // ─── AI-bot User-Agent matrix ─────────────────────────────
  describe("AI-bot UA matrix", () => {
    const botUAs = [
      "GPTBot/1.0",
      "ClaudeBot/1.0",
      "PerplexityBot/1.0",
      "Googlebot/2.1",
    ];

    for (const ua of botUAs) {
      it(`GET / with UA "${ua}" returns 200`, async () => {
        const res = await app.request("/", {
          headers: { "User-Agent": ua },
        });
        expect(res.status).toBe(200);
      });
    }
  });

  // ─── Content extraction (no JS) ───────────────────────────
  describe("Content extraction without JS", () => {
    let html: string;

    beforeAll(async () => {
      const res = await app.request("/", {
        headers: { "User-Agent": "GPTBot/1.0" },
      });
      html = await res.text();
    });

    it("contains product name (AgentGate)", () => {
      expect(html).toMatch(/AgentGate/i);
    });

    it("contains meta description", () => {
      expect(html).toMatch(/<meta\s+name="description"/i);
    });

    it("contains features section with capability cards", () => {
      expect(html).toContain('id="features"');
    });

    it("contains CTAs (links to /agent-guide, /pricing, /ui/agents)", () => {
      expect(html).toContain('href="/agent-guide"');
      expect(html).toContain('href="/pricing"');
      expect(html).toContain('href="/ui/agents"');
    });

    it("contains JSON-LD structured data", () => {
      expect(html).toContain('type="application/ld+json"');
    });

    it("contains HowTo schema for AI extraction", () => {
      expect(html).toContain("HowTo");
    });

    it("contains pricing information (HBAR)", () => {
      expect(html).toContain("HBAR");
    });

    it("contains architecture tech stack info", () => {
      expect(html).toContain("HTS");
      expect(html).toContain("HCS");
    });

    it("does not require JS (no Loading placeholder)", () => {
      expect(html).not.toMatch(/Loading\.\.\./i);
    });

    it("contains noscript fallback", () => {
      expect(html).toContain("<noscript>");
    });
  });

  // ─── Full app integration (all routes) ────────────────────
  describe("Full app crawler simulation", () => {
    let fullApp: HonoType;

    beforeAll(() => {
      setupMockEnv();
      fullApp = makeTestApp();
      // Add well-known routes (robots.txt, sitemap.xml) not in makeTestApp
      fullApp.route("/", wellKnownRoutes);
    });

    it("GET / returns 200 on full app", async () => {
      const res = await fullApp.request("/");
      expect(res.status).toBe(200);
    });

    it("GET /robots.txt returns 200 on full app", async () => {
      const res = await fullApp.request("/robots.txt");
      expect(res.status).toBe(200);
    });

    it("GET /sitemap.xml returns 200 on full app", async () => {
      const res = await fullApp.request("/sitemap.xml");
      expect(res.status).toBe(200);
    });
  });
});
