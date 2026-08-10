import { describe, it, expect } from "vitest";

const BASE = "http://localhost:4021";

const HTML_PAGES = [
  "/",
  "/about",
  "/faq",
  "/pricing",
  "/services/scanner",
  "/services/passports",
  "/services/marketplace",
  "/blog",
  "/blog/what-is-agent-readiness",
  "/blog/mcp-vs-api",
  "/blog/x402-payments",
];

describe("OG + Twitter Cards on all HTML pages", () => {
  for (const path of HTML_PAGES) {
    it(`${path} has og:title`, async () => {
      const res = await fetch(`${BASE}${path}`);
      const html = await res.text();
      expect(html).toContain("og:title");
    });

    it(`${path} has og:description`, async () => {
      const res = await fetch(`${BASE}${path}`);
      const html = await res.text();
      expect(html).toContain("og:description");
    });

    it(`${path} has og:image`, async () => {
      const res = await fetch(`${BASE}${path}`);
      const html = await res.text();
      expect(html).toContain("og:image");
    });

    it(`${path} has og:url`, async () => {
      const res = await fetch(`${BASE}${path}`);
      const html = await res.text();
      expect(html).toContain("og:url");
    });

    it(`${path} has twitter:card`, async () => {
      const res = await fetch(`${BASE}${path}`);
      const html = await res.text();
      expect(html).toContain("twitter:card");
    });

    it(`${path} has twitter:title`, async () => {
      const res = await fetch(`${BASE}${path}`);
      const html = await res.text();
      expect(html).toContain("twitter:title");
    });

    it(`${path} has twitter:description`, async () => {
      const res = await fetch(`${BASE}${path}`);
      const html = await res.text();
      expect(html).toContain("twitter:description");
    });
  }

  it("OG image returns 200", async () => {
    const res = await fetch(`${BASE}/icons/og-image.png`);
    expect(res.status).toBe(200);
  });

  it("OG image has correct dimensions in meta", async () => {
    const res = await fetch(`${BASE}/`);
    const html = await res.text();
    expect(html).toContain('og:image:width" content="1200"');
    expect(html).toContain('og:image:height" content="630"');
  });
});
