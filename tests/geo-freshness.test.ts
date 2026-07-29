import { describe, it, expect, beforeAll } from "vitest";
import { Hono } from "hono";
import { wellKnownRoutes } from "../src/server/routes/well-known";
import { changelogRoutes } from "../src/server/routes/changelog";
import { contentPageRoutes } from "../src/server/routes/content-pages";
import { catalogRoutes } from "../src/server/routes/catalog";
import { uiRoutes } from "../src/server/routes/ui";
import { searchRoutes } from "../src/server/routes/search";
import { contactRoutes } from "../src/server/routes/contact";
import { agentGuideRoutes } from "../src/server/routes/agent-guide";
import { marketGuideRoutes } from "../src/server/routes/market-guide";
import { medicalGuideRoutes } from "../src/server/routes/medical-guide";
import { corsMiddleware } from "../src/server/middleware/cors";
import { rateLimitMiddleware } from "../src/server/middleware/rate-limit";
import { signatureVerificationMiddleware } from "../src/server/middleware/signature-verification";
import { BUILD_DATE, GIT_COMMIT } from "../src/server/lib/build-info";
import { softwareApplicationLd, webSiteLd, faqPageLd } from "../src/server/lib/json-ld";
import { Dashboard } from "../src/views/dashboard";
import { PUBLIC_PAGES } from "../src/server/lib/page-meta";

function makeTestApp(): Hono {
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

// ─── Unit: build-info constants ──────────────────────────────

describe("SLICE-18-11: build-info constants", () => {
  it("BUILD_DATE is a valid YYYY-MM-DD string", () => {
    expect(BUILD_DATE).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("GIT_COMMIT is a non-empty string", () => {
    expect(GIT_COMMIT.length).toBeGreaterThan(0);
  });

  it("BUILD_DATE is not a hardcoded stale date", () => {
    // Should be today's date (default) or from env — not a fixed past date
    const today = new Date().toISOString().slice(0, 10);
    // If BUILD_DATE env is set, it could differ; but if not set, it equals today
    if (!process.env.BUILD_DATE) {
      expect(BUILD_DATE).toBe(today);
    }
  });
});

// ─── Unit: JSON-LD dateModified ──────────────────────────────

describe("SLICE-18-11: JSON-LD dateModified", () => {
  it("softwareApplicationLd has dateModified matching BUILD_DATE", () => {
    const ld = softwareApplicationLd() as Record<string, unknown>;
    expect(ld.dateModified).toBe(BUILD_DATE);
  });

  it("webSiteLd has dateModified matching BUILD_DATE", () => {
    const ld = webSiteLd() as Record<string, unknown>;
    expect(ld.dateModified).toBe(BUILD_DATE);
  });

  it("faqPageLd has datePublished and dateModified", () => {
    const ld = faqPageLd([
      { question: "Test?", answer: "Yes." },
    ]) as Record<string, unknown>;
    expect(ld.datePublished).toBe(BUILD_DATE);
    expect(ld.dateModified).toBe(BUILD_DATE);
  });
});

// ─── Integration: sitemap lastmod ────────────────────────────

describe("SLICE-18-11: sitemap real lastmod", () => {
  let app: Hono;

  beforeAll(() => {
    process.env.MOCK_HEDERA = "true";
    app = makeTestApp();
  });

  it("every <url> has a <lastmod> element", async () => {
    const res = await app.request("/sitemap.xml");
    const text = await res.text();
    const urlBlocks = text.split("<url>").slice(1);
    for (const block of urlBlocks) {
      expect(block).toContain("<lastmod>");
      expect(block).toContain("</lastmod>");
    }
  });

  it("lastmod dates are valid YYYY-MM-DD format", async () => {
    const res = await app.request("/sitemap.xml");
    const text = await res.text();
    const lastmods = text.match(/<lastmod>([^<]+)<\/lastmod>/g);
    expect(lastmods).not.toBeNull();
    for (const lm of lastmods!) {
      const date = lm.replace(/<\/?lastmod>/g, "");
      expect(date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("/changelog is in sitemap", async () => {
    const res = await app.request("/sitemap.xml");
    const text = await res.text();
    expect(text).toContain("/changelog");
  });

  it("dynamic pages use BUILD_DATE as lastmod", async () => {
    const res = await app.request("/sitemap.xml");
    const text = await res.text();
    // Homepage and /ui/agents are dynamic — should use BUILD_DATE
    expect(text).toContain(`<lastmod>${BUILD_DATE}</lastmod>`);
  });

  it("lastmod count matches url count", async () => {
    const res = await app.request("/sitemap.xml");
    const text = await res.text();
    const urlCount = (text.match(/<url>/g) || []).length;
    const lastmodCount = (text.match(/<lastmod>/g) || []).length;
    expect(lastmodCount).toBe(urlCount);
  });
});

// ─── Integration: /changelog page ────────────────────────────

describe("SLICE-18-11: GET /changelog", () => {
  let app: Hono;

  beforeAll(() => {
    process.env.MOCK_HEDERA = "true";
    app = makeTestApp();
  });

  it("returns 200", async () => {
    const res = await app.request("/changelog");
    expect(res.status).toBe(200);
  });

  it("returns HTML content", async () => {
    const res = await app.request("/changelog");
    expect(res.headers.get("content-type")).toContain("text/html");
  });

  it("has <title> containing Changelog", async () => {
    const res = await app.request("/changelog");
    const html = await res.text();
    expect(html).toMatch(/<title>[^<]*Changelog[^<]*<\/title>/i);
  });

  it("contains at least 5 changelog entries (article elements)", async () => {
    const res = await app.request("/changelog");
    const html = await res.text();
    const articleCount = (html.match(/<article/g) || []).length;
    expect(articleCount).toBeGreaterThanOrEqual(5);
  });

  it("entries are newest-first (first date >= last date)", async () => {
    const res = await app.request("/changelog");
    const html = await res.text();
    const dates = [...html.matchAll(/datetime="(\d{4}-\d{2}-\d{2})"/g)].map(
      (m) => m[1],
    );
    expect(dates.length).toBeGreaterThanOrEqual(2);
    expect(dates[0] >= dates[dates.length - 1]).toBe(true);
  });

  it("contains meta description", async () => {
    const res = await app.request("/changelog");
    const html = await res.text();
    expect(html).toMatch(/<meta name="description" content="[^"]+"/i);
  });

  it("contains build/commit marker", async () => {
    const res = await app.request("/changelog");
    const html = await res.text();
    expect(html).toContain(GIT_COMMIT);
  });
});

// ─── Integration: dashboard live-data proof ──────────────────

describe("SLICE-18-11: dashboard live-data proof markers", () => {
  it("Dashboard SSR contains 'Live data as of' with BUILD_DATE", () => {
    const html = Dashboard().toString();
    expect(html).toContain("Live data as of");
    expect(html).toContain(BUILD_DATE);
  });

  it("Dashboard SSR contains HashScan link", () => {
    const html = Dashboard().toString();
    expect(html).toContain("hashscan.io");
    expect(html).toContain("Verify on HashScan");
  });

  it("Dashboard SSR with stats contains passport count", () => {
    const html = Dashboard({
      stats: { totalIssued: 42, totalUpgrades: 5, activeCount: 40, revokedCount: 2, byTier: { bronze: 20, silver: 10, gold: 8, platinum: 4 } },
    }).toString();
    expect(html).toContain("42 passports on-chain");
  });
});

// ─── Integration: /changelog in PUBLIC_PAGES ─────────────────

describe("SLICE-18-11: /changelog wired into navigation", () => {
  it("PUBLIC_PAGES includes /changelog", () => {
    const paths = PUBLIC_PAGES.map((p) => p.path);
    expect(paths).toContain("/changelog");
  });
});
