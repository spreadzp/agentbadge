import { describe, it, expect, beforeAll } from "vitest";
import { Hono } from "hono";
import { wellKnownRoutes } from "../src/server/routes/well-known";
import { uiRoutes } from "../src/server/routes/ui";
import { searchRoutes } from "../src/server/routes/search";
import { contactRoutes } from "../src/server/routes/contact";
import { agentGuideRoutes } from "../src/server/routes/agent-guide";
import { marketGuideRoutes } from "../src/server/routes/market-guide";
import { medicalGuideRoutes } from "../src/server/routes/medical-guide";
import { contentPageRoutes } from "../src/server/routes/content-pages";
import { catalogRoutes } from "../src/server/routes/catalog";
import { corsMiddleware } from "../src/server/middleware/cors";
import { rateLimitMiddleware } from "../src/server/middleware/rate-limit";
import { signatureVerificationMiddleware } from "../src/server/middleware/signature-verification";

function makeCrawlerTestApp(): Hono {
  const app = new Hono();
  app.use(corsMiddleware());
  app.use((c, next) => signatureVerificationMiddleware(c as any, next));
  app.use(rateLimitMiddleware());
  // Register wellKnownRoutes BEFORE uiRoutes (matching index.ts order)
  app.route("/", catalogRoutes);
  app.route("/", wellKnownRoutes);
  app.route("/", uiRoutes);
  app.route("/", searchRoutes);
  app.route("/", contactRoutes);
  app.route("/", agentGuideRoutes);
  app.route("/", marketGuideRoutes);
  app.route("/", medicalGuideRoutes);
  app.route("/", contentPageRoutes);
  return app;
}

describe("Crawler files integration (SLICE-18-3)", () => {
  let app: Hono;

  beforeAll(() => {
    process.env.MOCK_HEDERA = "true";
    app = makeCrawlerTestApp();
  });

  describe("GET /robots.txt", () => {
    it("returns 200", async () => {
      const res = await app.request("/robots.txt");
      expect(res.status).toBe(200);
    });

    it("includes Sitemap line with absolute URL", async () => {
      const res = await app.request("/robots.txt");
      const text = await res.text();
      expect(text).toMatch(/Sitemap:\s+https?:\/\/.+\/sitemap\.xml/);
    });
  });

  describe("GET /sitemap.xml", () => {
    it("returns 200 with valid XML", async () => {
      const res = await app.request("/sitemap.xml");
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain("<?xml");
      expect(text).toContain("<urlset");
    });

    it("has >= 10 url entries", async () => {
      const res = await app.request("/sitemap.xml");
      const text = await res.text();
      const count = (text.match(/<url>/g) || []).length;
      expect(count).toBeGreaterThanOrEqual(10);
    });
  });

  describe("Every sitemap URL returns 200", () => {
    it("all loc URLs are reachable", async () => {
      const res = await app.request("/sitemap.xml");
      const text = await res.text();

      const locs = text
        .match(/<loc>([^<]+)<\/loc>/g)
        ?.map((m) => m.replace(/<\/?loc>/g, "")) ?? [];

      expect(locs.length).toBeGreaterThanOrEqual(10);

      for (const loc of locs) {
        const url = new URL(loc);
        const res = await app.request(url.pathname);
        expect(res.status).toBe(200);
      }
    });
  });

  describe("Disallowed paths are not in sitemap", () => {
    it("does not contain /admin", async () => {
      const res = await app.request("/sitemap.xml");
      const text = await res.text();
      expect(text).not.toContain("/admin");
    });

    it("does not contain /ui/a2a/inbox/fragment", async () => {
      const res = await app.request("/sitemap.xml");
      const text = await res.text();
      expect(text).not.toContain("/ui/a2a/inbox/fragment");
    });
  });
});
