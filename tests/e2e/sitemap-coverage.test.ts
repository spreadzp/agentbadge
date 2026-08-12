import { describe, it, expect } from "vitest";

const BASE = "http://localhost:4021";

describe("Sitemap Coverage + Lastmod (SLICE-53-4)", () => {
  it("sitemap returns 200", async () => {
    const res = await fetch(`${BASE}/sitemap.xml`);
    expect(res.status).toBe(200);
  });

  it("sitemap includes all service pages", async () => {
    const res = await fetch(`${BASE}/sitemap.xml`);
    const text = await res.text();
    expect(text).toContain("/services/scanner");
    expect(text).toContain("/services/passports");
    expect(text).toContain("/services/marketplace");
  });

  it("sitemap includes blog", async () => {
    const res = await fetch(`${BASE}/sitemap.xml`);
    const text = await res.text();
    expect(text).toContain("/blog");
  });

  it("sitemap includes blog articles", async () => {
    const res = await fetch(`${BASE}/sitemap.xml`);
    const text = await res.text();
    expect(text).toContain("/blog/what-is-agent-readiness");
    expect(text).toContain("/blog/mcp-vs-api");
    expect(text).toContain("/blog/x402-payments");
  });

  it("sitemap includes all guides", async () => {
    const res = await fetch(`${BASE}/sitemap.xml`);
    const text = await res.text();
    expect(text).toContain("/agent-guide");
    expect(text).toContain("/market-guide");
    expect(text).toContain("/marketplace-guide");
    expect(text).toContain("/medical-guide");
  });

  it("sitemap includes about, faq, pricing", async () => {
    const res = await fetch(`${BASE}/sitemap.xml`);
    const text = await res.text();
    expect(text).toContain("/about");
    expect(text).toContain("/faq");
    expect(text).toContain("/pricing");
  });

  it("sitemap includes about page (was /team, now redirected)", async () => {
    const res = await fetch(`${BASE}/sitemap.xml`);
    const text = await res.text();
    expect(text).toContain("/about");
    expect(text).not.toContain("/team</loc>");
  });

  it("sitemap has lastmod entries", async () => {
    const res = await fetch(`${BASE}/sitemap.xml`);
    const text = await res.text();
    expect(text).toContain("<lastmod>");
  });

  it("sitemap has changefreq entries", async () => {
    const res = await fetch(`${BASE}/sitemap.xml`);
    const text = await res.text();
    expect(text).toContain("<changefreq>");
  });

  it("sitemap has priority entries", async () => {
    const res = await fetch(`${BASE}/sitemap.xml`);
    const text = await res.text();
    expect(text).toContain("<priority>");
  });
});
