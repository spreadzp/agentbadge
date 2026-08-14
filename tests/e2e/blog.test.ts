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

  it("GET /blog/:slug has Article JSON-LD", async () => {
    const res = await fetch(`${BASE}/blog/what-is-agent-readiness`);
    const html = await res.text();
    expect(html).toContain('"@type":"Article"');
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
    const res = await fetch(`${BASE}/blog/what-is-agent-readiness`);
    const html = await res.text();
    expect(html).not.toContain("Also published on");
  });

  it("JSON-LD includes dateModified", async () => {
    const res = await fetch(`${BASE}/blog/what-is-agent-readiness`);
    const html = await res.text();
    expect(html).toContain('"dateModified"');
  });
});
