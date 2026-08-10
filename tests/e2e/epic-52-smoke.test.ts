import { describe, it, expect } from "vitest";

const BASE = "http://localhost:4021";

const PILLAR_SLUGS = [
  "what-is-agent-readiness",
  "mcp-vs-api",
  "x402-payments",
];

describe("EPIC-52 E2E Smoke", () => {
  it("/blog returns 200", async () => {
    const res = await fetch(`${BASE}/blog`);
    expect(res.status).toBe(200);
  });

  it("/blog/rss.xml returns 200", async () => {
    const res = await fetch(`${BASE}/blog/rss.xml`);
    expect(res.status).toBe(200);
  });

  for (const slug of PILLAR_SLUGS) {
    it(`/blog/${slug} returns 200`, async () => {
      const res = await fetch(`${BASE}/blog/${slug}`);
      expect(res.status).toBe(200);
    });

    it(`/blog/${slug} has Article JSON-LD`, async () => {
      const res = await fetch(`${BASE}/blog/${slug}`);
      const html = await res.text();
      expect(html).toContain('"@type":"Article"');
    });

    it(`/blog/${slug} has > 500 words`, async () => {
      const res = await fetch(`${BASE}/blog/${slug}`);
      const html = await res.text();
      const text = html.replace(/<[^>]+>/g, " ").trim();
      expect(text.split(/\s+/).length).toBeGreaterThan(500);
    });

    it(`/blog/${slug} has internal links to services or agent-guide`, async () => {
      const res = await fetch(`${BASE}/blog/${slug}`);
      const html = await res.text();
      expect(html).toMatch(/href="\/(services|agent-guide|blog)/);
    });

    it(`/blog/${slug} has canonical URL`, async () => {
      const res = await fetch(`${BASE}/blog/${slug}`);
      const html = await res.text();
      expect(html).toMatch(
        new RegExp(`<link rel="canonical" href="https://agentbadge.xyz/blog/${slug}"`),
      );
    });

    it(`/blog/${slug} has og:title`, async () => {
      const res = await fetch(`${BASE}/blog/${slug}`);
      const html = await res.text();
      expect(html).toContain("og:title");
    });
  }

  it("/blog/nonexistent returns 404", async () => {
    const res = await fetch(`${BASE}/blog/nonexistent-article`);
    expect(res.status).toBe(404);
  });

  it("robots.txt returns 200", async () => {
    const res = await fetch(`${BASE}/robots.txt`);
    expect(res.status).toBe(200);
  });

  it("sitemap.xml returns 200", async () => {
    const res = await fetch(`${BASE}/sitemap.xml`);
    expect(res.status).toBe(200);
  });

  it("sitemap includes /blog", async () => {
    const res = await fetch(`${BASE}/sitemap.xml`);
    const text = await res.text();
    expect(text).toContain("/blog");
  });

  for (const slug of PILLAR_SLUGS) {
    it(`sitemap includes /blog/${slug}`, async () => {
      const res = await fetch(`${BASE}/sitemap.xml`);
      const text = await res.text();
      expect(text).toContain(`/blog/${slug}`);
    });
  }

  it("RSS feed has all 3 articles", async () => {
    const res = await fetch(`${BASE}/blog/rss.xml`);
    const body = await res.text();
    expect(body).toContain("<rss");
    expect(body).toContain("<channel>");
    const itemCount = (body.match(/<item>/g) || []).length;
    expect(itemCount).toBeGreaterThanOrEqual(3);
  });
});
