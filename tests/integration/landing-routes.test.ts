import { describe, it, expect, beforeAll } from "vitest";
import { Hono } from "hono";
import { setupMockEnv } from "../e2e/helpers";
import { PageMeta, PUBLIC_PAGES } from "../../src/server/lib/page-meta";
import { landingRoutes } from "../../src/server/routes/landing";
import { uiRoutes } from "../../src/server/routes/ui";
import type { Hono as HonoType } from "hono";

// Build test app with landing routes registered BEFORE ui routes
function makeLandingTestApp(): HonoType {
  const app = new Hono();
  app.route("/", landingRoutes);
  app.route("/", uiRoutes);
  return app;
}

describe("SLICE-19-2: Routing — landing.ts + /dashboard", () => {
  let app: HonoType;

  beforeAll(() => {
    setupMockEnv();
    app = makeLandingTestApp();
  });

  // ─── GET / → Landing page ────────────────────────────────
  describe("GET / → landing page", () => {
    it("returns 200", async () => {
      const res = await app.request("/");
      expect(res.status).toBe(200);
    });

    it("returns HTML with LandingLayout (no sidebar)", async () => {
      const res = await app.request("/");
      const html = await res.text();
      expect(html).toContain("<!DOCTYPE html>");
      expect(html).toContain("<header");
      expect(html).not.toContain("sidebar-toggle");
      expect(html).not.toContain("<aside");
    });

    it("contains landing page title (not Dashboard)", async () => {
      const res = await app.request("/");
      const html = await res.text();
      expect(html).toContain("<title>");
      expect(html).not.toContain("Dashboard — AgentBadge");
    });

    it("contains skip-to-content link", async () => {
      const res = await app.request("/");
      const html = await res.text();
      expect(html).toContain('href="#main"');
    });

    it("contains noscript fallback with /dashboard link", async () => {
      const res = await app.request("/");
      const html = await res.text();
      expect(html).toContain("<noscript>");
      expect(html).toContain("/dashboard");
    });

    it("SLICE-110-8: contains id=agent-readiness-landing (not agency-hub)", async () => {
      const res = await app.request("/");
      const html = await res.text();
      expect(html).toContain('id="agent-readiness-landing"');
      expect(html).not.toContain('id="agency-hub"');
    });

    it("SLICE-110-8: contains new hero H1 text", async () => {
      const res = await app.request("/");
      const html = await res.text();
      expect(html).toContain("Can AI Agents Actually");
      expect(html).toContain("Use Your API?");
    });
  });

  // ─── GET /dashboard → Dashboard page ─────────────────────
  describe("GET /dashboard → dashboard page", () => {
    it("returns 200", async () => {
      const res = await app.request("/dashboard");
      expect(res.status).toBe(200);
    });

    it("returns HTML with dashboard Layout (has sidebar)", async () => {
      const res = await app.request("/dashboard");
      const html = await res.text();
      expect(html).toContain("<!DOCTYPE html>");
      expect(html).toContain("sidebar-toggle");
      expect(html).toContain("<aside");
    });

    it("contains Dashboard title", async () => {
      const res = await app.request("/dashboard");
      const html = await res.text();
      expect(html).toContain("Dashboard");
    });

    it("contains passport-feed div (dashboard content)", async () => {
      const res = await app.request("/dashboard");
      const html = await res.text();
      expect(html).toContain('id="passport-feed"');
    });
  });

  // ─── PageMeta updates ────────────────────────────────────
  describe("PageMeta registry", () => {
    it('has "/" entry with landing page title', () => {
      expect(PageMeta["/"]).toBeDefined();
      expect(PageMeta["/"].title).not.toBe("Dashboard");
    });

    it('has "/dashboard" entry with Dashboard title', () => {
      expect(PageMeta["/dashboard"]).toBeDefined();
      expect(PageMeta["/dashboard"].title).toBe("Dashboard");
    });

    it('"/" description mentions agent readiness scanning', () => {
      expect(PageMeta["/"].description).toContain("agent readiness");
      expect(PageMeta["/"].description).toContain("scan");
    });
  });

  // ─── PUBLIC_PAGES (sitemap) ──────────────────────────────
  describe("PUBLIC_PAGES sitemap", () => {
    it('contains "/" with priority 1.0', () => {
      const entry = PUBLIC_PAGES.find((p) => p.path === "/");
      expect(entry).toBeDefined();
      expect(entry!.priority).toBe("1.0");
    });

    it('contains "/dashboard"', () => {
      const entry = PUBLIC_PAGES.find((p) => p.path === "/dashboard");
      expect(entry).toBeDefined();
    });
  });

  // ─── No regression: /ui/* routes still work ──────────────
  describe("No regression: /ui/* routes", () => {
    it("GET /ui/agents → 200", async () => {
      const res = await app.request("/ui/agents", {
        headers: { "HX-Request": "true" },
      });
      expect(res.status).toBe(200);
    });

    it("GET /ui/search → 200", async () => {
      const res = await app.request("/ui/search", {
        headers: { "HX-Request": "true" },
      });
      expect(res.status).toBe(200);
    });
  });
});
