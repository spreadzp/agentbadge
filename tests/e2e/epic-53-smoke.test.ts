import { describe, it, expect } from "vitest";

const BASE = "http://localhost:4021";

describe("EPIC-53 E2E Smoke (SLICE-53-7)", () => {
  // E-E-A-T: Person JSON-LD
  it("/about has Person JSON-LD", async () => {
    const res = await fetch(`${BASE}/about`);
    const html = await res.text();
    expect(html).toContain('"@type":"Person"');
  });

  // Dates: blog articles have visible dates
  it("blog articles have visible dates", async () => {
    const res = await fetch(`${BASE}/blog/what-is-agent-readiness`);
    const html = await res.text();
    expect(html).toMatch(/date|published|updated/i);
  });

  // Dates: agent-guide has dateModified in JSON-LD
  it("agent-guide has dateModified in JSON-LD", async () => {
    const res = await fetch(`${BASE}/agent-guide`, {
      headers: { Accept: "text/html" },
    });
    const html = await res.text();
    expect(html).toContain("dateModified");
  });

  // Cross-links: agent-guide has See Also section
  it("agent-guide has See Also section", async () => {
    const res = await fetch(`${BASE}/agent-guide`, {
      headers: { Accept: "text/html" },
    });
    const html = await res.text();
    expect(html).toMatch(/see also|related guides|more guides/i);
  });

  // Cross-links: agent-guide links to services
  it("agent-guide links to services", async () => {
    const res = await fetch(`${BASE}/agent-guide`, {
      headers: { Accept: "text/html" },
    });
    const html = await res.text();
    expect(html).toContain("/services/");
  });

  // Sitemap: all pages with lastmod
  it("sitemap has all pages with lastmod", async () => {
    const res = await fetch(`${BASE}/sitemap.xml`);
    const text = await res.text();
    expect(text).toContain("<lastmod>");
    expect(text).toContain("/services/");
    expect(text).toContain("/blog");
  });

  // Sitemap: includes marketplace-guide and team
  it("sitemap includes marketplace-guide and team", async () => {
    const res = await fetch(`${BASE}/sitemap.xml`);
    const text = await res.text();
    expect(text).toContain("/marketplace-guide");
    expect(text).toContain("/team");
  });

  // llms-full.txt
  it("/llms-full.txt returns 200", async () => {
    const res = await fetch(`${BASE}/llms-full.txt`);
    expect(res.status).toBe(200);
  });

  it("/llms-full.txt has FAQ content", async () => {
    const res = await fetch(`${BASE}/llms-full.txt`);
    const text = await res.text();
    expect(text).toMatch(/FAQ/i);
    expect(text).toMatch(/What is AgentBadge/i);
  });

  it("llms.txt links to llms-full.txt", async () => {
    const res = await fetch(`${BASE}/llms.txt`);
    const text = await res.text();
    expect(text).toContain("llms-full.txt");
  });

  // Meta robots: all pages have AI directives
  it("all pages have meta robots with AI directives", async () => {
    const pages = [
      { path: "/", accept: undefined },
      { path: "/about", accept: undefined },
      { path: "/faq", accept: undefined },
      { path: "/agent-guide", accept: "text/html" },
    ];
    for (const page of pages) {
      const res = await fetch(`${BASE}${page.path}`, {
        headers: page.accept ? { Accept: page.accept } : {},
      });
      const html = await res.text();
      expect(html).toContain("max-image-preview:large");
      expect(html).toContain("max-snippet:-1");
    }
  });
});
