import { describe, it, expect, beforeAll } from "vitest";
import type { Hono } from "hono";

process.env.MOCK_HEDERA = "true";
// Use the real app: a hand-built subset drifts from registerPageRoutes and
// sitemap URLs silently 404. Dynamic import so MOCK_HEDERA is set first.
const { createApp } = await import("../src/server/index");

describe("Crawler files integration (SLICE-18-3)", () => {
  let app: Hono;

  beforeAll(() => {
    app = createApp();
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
