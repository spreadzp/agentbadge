import { describe, it, expect } from "vitest";

const BASE = "http://localhost:4021";

describe("Blog infrastructure (SLICE-52-1)", () => {
  it("GET /blog returns 200", async () => {
    const res = await fetch(`${BASE}/blog`);
    expect(res.status).toBe(200);
  });

  it("GET /blog has article listing", async () => {
    const res = await fetch(`${BASE}/blog`);
    const html = await res.text();
    expect(html).toMatch(/<article|blog-post|article-card/i);
  });

  it("GET /blog/what-is-agent-readiness returns 200", async () => {
    const res = await fetch(`${BASE}/blog/what-is-agent-readiness`);
    expect(res.status).toBe(200);
  });

  it("GET /blog/:slug has article JSON-LD", async () => {
    const res = await fetch(`${BASE}/blog/what-is-agent-readiness`);
    const html = await res.text();
    expect(html).toMatch(/"@type":"(BlogPosting|TechArticle)"/);
  });

  it("GET /blog/rss.xml returns valid RSS XML", async () => {
    const res = await fetch(`${BASE}/blog/rss.xml`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type") ?? "").toContain("xml");
    const body = await res.text();
    expect(body).toContain("<rss");
    expect(body).toContain("<channel>");
    expect(body).toContain("<item>");
  });

  it("GET /blog/nonexistent returns 404", async () => {
    const res = await fetch(`${BASE}/blog/nonexistent-article`);
    expect(res.status).toBe(404);
  });

  it("GET /blog has canonical URL", async () => {
    const res = await fetch(`${BASE}/blog`);
    const html = await res.text();
    expect(html).toMatch(/<link rel="canonical" href="https:\/\/agentbadge\.xyz\/blog"/);
  });

  it("GET /blog/:slug has canonical URL", async () => {
    const res = await fetch(`${BASE}/blog/what-is-agent-readiness`);
    const html = await res.text();
    expect(html).toMatch(/<link rel="canonical" href="https:\/\/agentbadge\.xyz\/blog\/what-is-agent-readiness"/);
  });

  it("Blog link in navigation", async () => {
    const res = await fetch(`${BASE}/`);
    const html = await res.text();
    expect(html).toMatch(/href="\/blog"/i);
  });

  it("Blog link in footer", async () => {
    const res = await fetch(`${BASE}/`);
    const html = await res.text();
    expect(html).toContain('href="/blog"');
    expect(html).toMatch(/Blog\s*<\/a>/);
  });

  it("Blog in sitemap", async () => {
    const res = await fetch(`${BASE}/sitemap.xml`);
    const xml = await res.text();
    expect(xml).toContain("/blog");
    expect(xml).toContain("/blog/what-is-agent-readiness");
  });
});

describe("Blog agent-readiness (SLICE-60-1)", () => {
  it("GET /blog/:slug renders For AI Agents block", async () => {
    const res = await fetch(`${BASE}/blog/what-is-agent-readiness`);
    const html = await res.text();
    expect(html).toContain("For AI Agents");
    expect(html).toContain('aria-label="For AI Agents"');
  });

  it("For AI Agents block has gateway links", async () => {
    const res = await fetch(`${BASE}/blog/what-is-agent-readiness`);
    const html = await res.text();
    expect(html).toContain('href="/agent-guide/"');
    expect(html).toContain('href="/llms.txt"');
    expect(html).toContain('href="/agent-guide/team/services"');
  });

  it("Article with agentGuideSlug links to companion guide", async () => {
    const res = await fetch(`${BASE}/blog/what-is-agent-readiness`);
    const html = await res.text();
    expect(html).toContain('href="/agent-guide/articles/what-is-agent-readiness"');
  });

  it("Article without externalLinks does not render Also published on", async () => {
    const res = await fetch(`${BASE}/blog/mcp-vs-api`);
    const html = await res.text();
    expect(html).not.toContain("Also published on");
  });

  it("JSON-LD includes dateModified", async () => {
    const res = await fetch(`${BASE}/blog/what-is-agent-readiness`);
    const html = await res.text();
    expect(html).toContain('"dateModified"');
  });
});

describe("Blog: The Bedrij Principle (SLICE-211-4)", () => {
  const SLUG = "bedrij-principle";

  it("GET /blog/bedrij-principle returns 200", async () => {
    const res = await fetch(`${BASE}/blog/${SLUG}`);
    expect(res.status).toBe(200);
  });

  it("article renders hero image", async () => {
    const res = await fetch(`${BASE}/blog/${SLUG}`);
    const html = await res.text();
    expect(html).toContain("/images/blog/bedrij-principle-hero.webp");
  });

  it("article has TechArticle JSON-LD + title", async () => {
    const res = await fetch(`${BASE}/blog/${SLUG}`);
    const html = await res.text();
    expect(html).toContain('"@type":"TechArticle"');
    expect(html).toContain("The Bedrij Principle");
  });

  it("GET /blog/bedrij-principle.md returns markdown", async () => {
    const res = await fetch(`${BASE}/blog/${SLUG}.md`);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("The Bedrij Principle");
    expect(body).toContain("For AI Agents");
  });

  it("GET /blog/bedrij-principle.json returns Knowledge Object", async () => {
    const res = await fetch(`${BASE}/blog/${SLUG}.json`);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { slug?: string; status?: string };
    expect(json.slug).toBe(SLUG);
    expect(json.status).toBe("EXPERIMENT");
  });

  it("transition diagram image is embedded inline", async () => {
    const res = await fetch(`${BASE}/blog/${SLUG}`);
    const html = await res.text();
    expect(html).toContain("/images/blog/bedrij-principle-2.webp");
  });

  it("sitemap includes the new article", async () => {
    const res = await fetch(`${BASE}/sitemap.xml`);
    const xml = await res.text();
    expect(xml).toContain(`/blog/${SLUG}`);
  });
});

describe("Blog: Brick #2 — Typed Evidence (SLICE-213-6)", () => {
  const SLUG = "supply-chain-typed-evidence";

  it("GET /blog/supply-chain-typed-evidence returns 200", async () => {
    const res = await fetch(`${BASE}/blog/${SLUG}`);
    expect(res.status).toBe(200);
  });

  it("article renders hero image", async () => {
    const res = await fetch(`${BASE}/blog/${SLUG}`);
    const html = await res.text();
    expect(html).toContain("/images/blog/supply-chain-typed-evidence-hero.webp");
  });

  it("article has TechArticle JSON-LD + title", async () => {
    const res = await fetch(`${BASE}/blog/${SLUG}`);
    const html = await res.text();
    expect(html).toContain('"@type":"TechArticle"');
    expect(html).toContain("Typed Evidence");
  });

  it("GET /blog/supply-chain-typed-evidence.md returns markdown", async () => {
    const res = await fetch(`${BASE}/blog/${SLUG}.md`);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("Typed Evidence");
    expect(body).toContain("For AI Agents");
  });

  it("GET /blog/supply-chain-typed-evidence.json returns Knowledge Object", async () => {
    const res = await fetch(`${BASE}/blog/${SLUG}.json`);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { slug?: string; status?: string };
    expect(json.slug).toBe(SLUG);
    expect(json.status).toBe("EXPERIMENT");
  });

  it("lifecycle + inline images are embedded", async () => {
    const res = await fetch(`${BASE}/blog/${SLUG}`);
    const html = await res.text();
    expect(html).toContain("/images/blog/supply-chain-typed-evidence-d1.webp");
    expect(html).toContain("/images/blog/supply-chain-typed-evidence-2.webp");
    expect(html).toContain("/images/blog/supply-chain-typed-evidence-3.webp");
  });

  it("article links back to C38 anchor and C39 brick #1", async () => {
    const res = await fetch(`${BASE}/blog/${SLUG}`);
    const html = await res.text();
    expect(html).toContain("/blog/bedrij-principle");
    expect(html).toContain("/blog/supply-chain-participant-roles");
  });

  it("sitemap includes the new article", async () => {
    const res = await fetch(`${BASE}/sitemap.xml`);
    const xml = await res.text();
    expect(xml).toContain(`/blog/${SLUG}`);
  });
});
