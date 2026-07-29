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
});
