import { describe, it, expect } from "vitest";
import { makeTestApp, setupMockEnv } from "../e2e/helpers";
import { buildSitemap } from "../../src/server/routes/well-known/sitemaps";

setupMockEnv();
const app = makeTestApp();

/**
 * SLICE-234-25: /en-us/ hreflang pilot — US-localized page paired
 * with / via hreflang alternates + x-default. Content must differ
 * from / (USD/USDC/US framing), not be a duplicate.
 */
describe("SLICE-234-25: /en-us hreflang pilot", () => {
  it("GET /en-us → 200 HTML", async () => {
    const res = await app.request("/en-us");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
  });

  it("/en-us emits hreflang alternates + x-default + self-canonical", async () => {
    const html = await (await app.request("/en-us")).text();
    expect(html).toContain('hreflang="en"');
    expect(html).toContain('hreflang="x-default"');
    expect(html).toContain('rel="canonical" href="https://agentbadge.xyz/en-us"');
    expect(html).toContain('og:locale" content="en_US"');
  });

  it("/ emits reciprocal alternate → /en-us", async () => {
    const html = await (await app.request("/")).text();
    expect(html).toContain('hreflang="en-US"');
    expect(html).toContain("/en-us");
    expect(html).toContain('hreflang="x-default"');
  });

  it("/en-us content is US-localized, not a duplicate of /", async () => {
    const html = await (await app.request("/en-us")).text();
    expect(html).toContain("USDC");
    expect(html).toContain("USD");
    expect(html).toContain("US businesses");
    expect(html).toContain("US compliance");
    // US-specific framing absent from the global page
    const global = await (await app.request("/")).text();
    expect(global).not.toContain("US compliance notes");
  });

  // /en-us/ → 301 /en-us is trailingSlashMiddleware behavior — covered
  // by crawler-files.test.ts (createApp) + canonical-redirects tests.

  it("sitemap.xml contains /en-us with xhtml:link hreflang annotations", () => {
    const xml = buildSitemap();
    expect(xml).toContain("/en-us");
    expect(xml).toContain("xmlns:xhtml");
    expect(xml).toContain('hreflang="en-US"');
    expect(xml).toContain('hreflang="x-default"');
  });
});
