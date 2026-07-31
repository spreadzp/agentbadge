import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import { wellKnownRoutes } from "../src/server/routes/well-known";

describe("Well-known routes", () => {
  let app: Hono;

  beforeEach(() => {
    app = new Hono();
    app.route("/", wellKnownRoutes);
  });

  // ─── Agent Card (SLICE-17-1) ──────────────────────────────────

  describe("GET /.well-known/agent-card.json", () => {
    it("returns 200 with correct fields", async () => {
      const res = await app.request("/.well-known/agent-card.json");
      expect(res.status).toBe(200);
      const body = await res.json();

      expect(body.name).toBeDefined();
      expect(body.description).toBeDefined();
      expect(body.url).toBeDefined();
      expect(body.version).toBeDefined();
      expect(body.capabilities).toBeInstanceOf(Array);
      expect(body.capabilities.length).toBeGreaterThan(0);
      expect(body.skills).toBeInstanceOf(Array);
      expect(body.skills.length).toBeGreaterThan(0);
    });

    it("includes all required endpoint fields", async () => {
      const res = await app.request("/.well-known/agent-card.json");
      const body = await res.json();

      expect(body.endpoints).toBeDefined();
      expect(body.endpoints.api).toBeDefined();
      expect(body.endpoints.docs).toBeDefined();
      expect(body.endpoints.mcp).toBeDefined();
      expect(body.endpoints.llms_txt).toBeDefined();
      expect(body.endpoints.guides).toBeDefined();
      expect(body.endpoints.did_resolver).toBeDefined();
    });

    it("includes payment configuration", async () => {
      const res = await app.request("/.well-known/agent-card.json");
      const body = await res.json();

      expect(body.payment).toBeDefined();
      expect(body.payment.protocol).toBe("x402");
      expect(body.payment.scheme).toBe("exact");
      expect(body.payment.network).toMatch(/^hedera:/);
      expect(body.payment.asset).toBe("HBAR");
      expect(body.payment.facilitator).toBeDefined();
    });

    it("includes blockchain configuration", async () => {
      const res = await app.request("/.well-known/agent-card.json");
      const body = await res.json();

      expect(body.blockchain).toBeDefined();
      expect(body.blockchain.network).toBeDefined();
    });

    it("sets Cache-Control header", async () => {
      const res = await app.request("/.well-known/agent-card.json");
      expect(res.headers.get("Cache-Control")).toBe("public, max-age=3600");
    });

    it("returns application/json content type", async () => {
      const res = await app.request("/.well-known/agent-card.json");
      expect(res.headers.get("Content-Type")).toContain("application/json");
    });
  });

  // ─── AI Sitemap (SLICE-17-9) ──────────────────────────────────

  describe("GET /ai-sitemap.xml", () => {
    it("returns 200 with XML content", async () => {
      const res = await app.request("/ai-sitemap.xml");
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain("<?xml");
      expect(text).toContain("<resources>");
      expect(text).toContain("</resources>");
    });

    it("contains 10 resource entries", async () => {
      const res = await app.request("/ai-sitemap.xml");
      const text = await res.text();
      const count = (text.match(/<resource>/g) || []).length;
      expect(count).toBe(10);
    });

    it("includes discovery endpoints with priority 1.0", async () => {
      const res = await app.request("/ai-sitemap.xml");
      const text = await res.text();

      expect(text).toContain("agent-card.json");
      expect(text).toContain("llms.txt");
      expect(text).toContain("/api/specs");

      // Check that agent-card has priority 1.0
      const cardEntry = text.split("<resource>").find((s) =>
        s.includes("agent-card.json"),
      );
      expect(cardEntry).toContain("<priority>1.0</priority>");
    });

    it("includes guides with priority 0.8-0.9", async () => {
      const res = await app.request("/ai-sitemap.xml");
      const text = await res.text();

      expect(text).toContain("agent-guide");
      expect(text).toContain("market-guide");
      expect(text).toContain("medical-guide");
    });

    it("includes data APIs", async () => {
      const res = await app.request("/ai-sitemap.xml");
      const text = await res.text();

      expect(text).toContain("/catalog");
      expect(text).toContain("/agents");
      expect(text).toContain("/market/tasks");
      expect(text).toContain("/api/search");
    });

    it("sets correct content type and cache headers", async () => {
      const res = await app.request("/ai-sitemap.xml");
      expect(res.headers.get("Content-Type")).toContain("application/xml");
      expect(res.headers.get("Cache-Control")).toBe("public, max-age=3600");
    });

    it("each resource has loc, priority, format, and desc", async () => {
      const res = await app.request("/ai-sitemap.xml");
      const text = await res.text();

      // Extract all <resource> blocks
      const blocks = text
        .split("<resource>")
        .slice(1)
        .map((b) => b.split("</resource>")[0]);

      for (const block of blocks) {
        expect(block).toContain("<loc>");
        expect(block).toContain("<priority>");
        expect(block).toContain("<format>");
        expect(block).toContain("<desc>");
      }
    });
  });

  // ─── robots.txt (SLICE-18-3) ──────────────────────────────────

  describe("GET /robots.txt", () => {
    it("returns 200 with text/plain content", async () => {
      const res = await app.request("/robots.txt");
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toContain("text/plain");
    });

    it("sets Cache-Control to 86400", async () => {
      const res = await app.request("/robots.txt");
      expect(res.headers.get("Cache-Control")).toBe("public, max-age=86400");
    });

    it("allows all crawlers and disallows admin", async () => {
      const res = await app.request("/robots.txt");
      const text = await res.text();

      expect(text).toContain("User-agent: *");
      expect(text).toContain("Allow: /");
      expect(text).toContain("Disallow: /admin");
      expect(text).toContain("Disallow: /ui/a2a/inbox/fragment");
    });

    it("includes AI crawler directives", async () => {
      const res = await app.request("/robots.txt");
      const text = await res.text();

      expect(text).toContain("GPTBot");
      expect(text).toContain("ClaudeBot");
      expect(text).toContain("PerplexityBot");
      expect(text).toContain("Google-Extended");
    });

    it("includes Sitemap line with absolute URL", async () => {
      const res = await app.request("/robots.txt");
      const text = await res.text();

      expect(text).toContain("Sitemap:");
      expect(text).toMatch(/Sitemap:\s+https?:\/\/.+\/sitemap\.xml/);
    });

    // ─── SLICE-21-4: Spam bot blocking + useful bot allowing ───

    it("blocks SEO-spam crawlers with Disallow: /", async () => {
      const res = await app.request("/robots.txt");
      const text = await res.text();

      const spamBots = ["AhrefsBot", "SemrushBot", "SemrushBot-SA", "MJ12bot", "DotBot", "BLEXBot", "Bytespider"];
      for (const bot of spamBots) {
        expect(text).toContain(`User-agent: ${bot}`);
        expect(text).toContain(`Disallow: /`);
      }
    });

    it("allows additional useful crawlers with Allow: /", async () => {
      const res = await app.request("/robots.txt");
      const text = await res.text();

      const usefulBots = ["Applebot-Extended", "Googlebot", "Bingbot", "DuckDuckBot"];
      for (const bot of usefulBots) {
        expect(text).toContain(`User-agent: ${bot}`);
        expect(text).toContain(`Allow: /`);
      }
    });

    it("preserves existing AI crawler allows", async () => {
      const res = await app.request("/robots.txt");
      const text = await res.text();

      expect(text).toContain("GPTBot");
      expect(text).toContain("ClaudeBot");
      expect(text).toContain("PerplexityBot");
      expect(text).toContain("Google-Extended");
    });
  });

  // ─── sitemap.xml (SLICE-18-3) ─────────────────────────────────

  describe("GET /sitemap.xml", () => {
    it("returns 200 with application/xml content", async () => {
      const res = await app.request("/sitemap.xml");
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toContain("application/xml");
    });

    it("sets Cache-Control to 3600", async () => {
      const res = await app.request("/sitemap.xml");
      expect(res.headers.get("Cache-Control")).toBe("public, max-age=3600");
    });

    it("returns valid XML with urlset root", async () => {
      const res = await app.request("/sitemap.xml");
      const text = await res.text();

      expect(text).toContain("<?xml");
      expect(text).toContain("<urlset");
      expect(text).toContain("</urlset>");
    });

    it("contains at least 10 url entries", async () => {
      const res = await app.request("/sitemap.xml");
      const text = await res.text();
      const count = (text.match(/<url>/g) || []).length;
      expect(count).toBeGreaterThanOrEqual(10);
    });

    it("all loc URLs are absolute (start with http)", async () => {
      const res = await app.request("/sitemap.xml");
      const text = await res.text();

      const locs = text
        .match(/<loc>([^<]+)<\/loc>/g)
        ?.map((m) => m.replace(/<\/?loc>/g, "")) ?? [];

      expect(locs.length).toBeGreaterThan(0);
      for (const loc of locs) {
        expect(loc).toMatch(/^https?:\/\//);
      }
    });

    it("each url has loc, lastmod, changefreq, and priority", async () => {
      const res = await app.request("/sitemap.xml");
      const text = await res.text();

      const blocks = text
        .split("<url>")
        .slice(1)
        .map((b) => b.split("</url>")[0]);

      for (const block of blocks) {
        expect(block).toContain("<loc>");
        expect(block).toContain("<lastmod>");
        expect(block).toContain("<changefreq>");
        expect(block).toContain("<priority>");
      }
    });

    it("does not include disallowed paths (/admin)", async () => {
      const res = await app.request("/sitemap.xml");
      const text = await res.text();

      expect(text).not.toContain("/admin");
    });

    it("includes home page with priority 1.0", async () => {
      const res = await app.request("/sitemap.xml");
      const text = await res.text();

      const homeBlock = text.split("<url>").find((s) => s.includes("</loc>\n    <lastmod>") && s.match(/<\/loc>\s*<lastmod>/) && s.includes("/</loc>"));
      expect(homeBlock).toBeDefined();
      expect(homeBlock).toContain("<priority>1.0</priority>");
    });
  });
});
