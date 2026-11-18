import { describe, it, expect, beforeAll } from "vitest";
import { Hono } from "hono";
import { setupMockEnv } from "../e2e/helpers";
import { landingRoutes } from "../../src/server/routes/pages/landing";
import type { Hono as HonoType } from "hono";

describe("SLICE-19-13: Landing page integration — meta, JSON-LD, no-JS, full navigation", () => {
  let app: HonoType;
  let landingHtml: string;

  beforeAll(async () => {
    setupMockEnv();
    app = new Hono();
    app.route("/", landingRoutes);
    const res = await app.request("/");
    landingHtml = await res.text();
  });

  // ─── Meta tags ────────────────────────────────────────────
  describe("Meta tags", () => {
    it("has title tag with landing page title", () => {
      expect(landingHtml).toContain("<title>");
      expect(landingHtml).toContain("AgentBadge");
    });

    it("has meta description", () => {
      expect(landingHtml).toMatch(/<meta\s+name="description"/i);
    });

    it("has canonical link", () => {
      expect(landingHtml).toMatch(/<link\s+rel="canonical"/i);
    });

    it("has Open Graph tags", () => {
      expect(landingHtml).toMatch(/<meta\s+property="og:title"/i);
      expect(landingHtml).toMatch(/<meta\s+property="og:description"/i);
    });

    it("has Twitter card tags", () => {
      expect(landingHtml).toMatch(/<meta\s+name="twitter:card"/i);
    });
  });

  // ─── JSON-LD ──────────────────────────────────────────────
  describe("JSON-LD structured data", () => {
    it("contains application/ld+json script", () => {
      expect(landingHtml).toContain('type="application/ld+json"');
    });

    it("contains 4 schemas (SoftwareApplication, WebSite, Organization, HowTo)", () => {
      expect(landingHtml).toContain("SoftwareApplication");
      expect(landingHtml).toContain("WebSite");
      expect(landingHtml).toContain("Organization");
      expect(landingHtml).toContain("HowTo");
    });

    it("JSON-LD is parseable", () => {
      const matches = landingHtml.match(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g);
      expect(matches).not.toBeNull();
      expect(matches!.length).toBeGreaterThanOrEqual(1);
      // Extract and parse each script's JSON
      for (const match of matches!) {
        const jsonStr = match.replace(/<script[^>]*>/, "").replace(/<\/script>/, "");
        expect(() => JSON.parse(jsonStr)).not.toThrow();
      }
    });

    it("HowTo schema has 4 steps", () => {
      const matches = landingHtml.match(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g);
      expect(matches).not.toBeNull();
      let foundHowTo = false;
      for (const match of matches!) {
        const jsonStr = match.replace(/<script[^>]*>/, "").replace(/<\/script>/, "");
        const parsed = JSON.parse(jsonStr);
        // Could be array or single object
        const schemas = Array.isArray(parsed) ? parsed : [parsed];
        for (const schema of schemas) {
          if (schema["@type"] === "HowTo") {
            foundHowTo = true;
            expect(schema.step).toHaveLength(4);
          }
        }
      }
      expect(foundHowTo).toBe(true);
    });
  });

  // ─── No-JS fallback ───────────────────────────────────────
  describe("No-JS fallback (SSR content)", () => {
    it("does not contain 'Loading...' placeholder", () => {
      expect(landingHtml).not.toMatch(/Loading\.\.\./i);
    });

    it("contains SSR content (Hero section present)", () => {
      expect(landingHtml).toContain('id="scan"');
    });

    it("contains SSR content (Thesis section present)", () => {
      expect(landingHtml).toContain('id="thesis"');
    });

    it("contains SSR content (Evidence section present)", () => {
      expect(landingHtml).toContain('id="evidence"');
    });

    it("contains SSR content (How section present)", () => {
      expect(landingHtml).toContain('id="how"');
    });

    it("contains SSR content (Engineering CTA section present)", () => {
      expect(landingHtml).toContain('id="engineering-cta"');
    });

    it("contains noscript tag", () => {
      expect(landingHtml).toContain("<noscript>");
    });
  });

  // ─── no hx-boost (full page navigation for CTAs) ─────────
  describe("no hx-boost", () => {
    it("does not contain hx-boost attribute", () => {
      expect(landingHtml).not.toContain("hx-boost");
    });
  });

  // ─── All named sections present ──────────────────────────
  describe("All named sections present in HTML", () => {
    it("contains all section ids", () => {
      const ids = [
        "scan",
        "agent-ready-proof",
        "how",
        "evidence",
        "fix",
        "workflow",
        "agents",
        "pricing",
        "thesis",
        "engineering-cta",
      ];
      for (const id of ids) {
        expect(landingHtml).toContain(`id="${id}"`);
      }
    });
  });
});
