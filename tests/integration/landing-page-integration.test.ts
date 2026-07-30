import { describe, it, expect, beforeAll } from "vitest";
import { Hono } from "hono";
import { setupMockEnv } from "../e2e/helpers";
import { landingRoutes } from "../../src/server/routes/landing";
import type { Hono as HonoType } from "hono";

describe("SLICE-19-13: Landing page integration — meta, JSON-LD, no-JS, hx-boost", () => {
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
      expect(landingHtml).toContain("AgentGate");
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
      expect(landingHtml).toContain('id="hero"');
    });

    it("contains SSR content (Problem-Solution section present)", () => {
      expect(landingHtml).toContain('id="problem-solution"');
    });

    it("contains SSR content (Features section present)", () => {
      expect(landingHtml).toContain('id="features"');
    });

    it("contains SSR content (How It Works section present)", () => {
      expect(landingHtml).toContain('id="how-it-works"');
    });

    it("contains SSR content (CTA Footer section present)", () => {
      expect(landingHtml).toContain('id="cta-footer"');
    });

    it("contains noscript tag", () => {
      expect(landingHtml).toContain("<noscript>");
    });
  });

  // ─── hx-boost ─────────────────────────────────────────────
  describe("hx-boost", () => {
    it("contains hx-boost attribute", () => {
      expect(landingHtml).toContain("hx-boost");
    });

    it("hx-boost is set to true", () => {
      expect(landingHtml).toContain('hx-boost="true"');
    });
  });

  // ─── All 9 sections present ───────────────────────────────
  describe("All 9 sections present in HTML", () => {
    it("contains all section ids", () => {
      const ids = [
        "hero",
        "landing-stats",
        "problem-solution",
        "features",
        "how-it-works",
        "for-who",
        "architecture",
        "pricing",
        "cta-footer",
      ];
      for (const id of ids) {
        expect(landingHtml).toContain(`id="${id}"`);
      }
    });
  });
});
