import { describe, it, expect } from "vitest";
import { COMPARISON_PAGES } from "../../src/server/lib/comparison-data";

const BASE = "http://localhost:4021";

describe("SLICE-117-3: Comparison routes", () => {
  it("GET /comparisons returns 200", async () => {
    const res = await fetch(`${BASE}/comparisons`);
    expect(res.status).toBe(200);
  });

  it("GET /comparisons/agentbadge-vs-mcp returns 200", async () => {
    const res = await fetch(`${BASE}/comparisons/agentbadge-vs-mcp`);
    expect(res.status).toBe(200);
  });

  it("GET /comparisons/agentbadge-vs-postman returns 200", async () => {
    const res = await fetch(`${BASE}/comparisons/agentbadge-vs-postman`);
    expect(res.status).toBe(200);
  });

  it("GET /comparisons/agentbadge-vs-swagger returns 200", async () => {
    const res = await fetch(`${BASE}/comparisons/agentbadge-vs-swagger`);
    expect(res.status).toBe(200);
  });

  it("Hub page contains overview table with all 3 tool names", async () => {
    const res = await fetch(`${BASE}/comparisons`);
    const html = await res.text();
    expect(html).toContain("Overview");
    expect(html).toContain("<table");
    for (const page of COMPARISON_PAGES) {
      expect(html).toContain(page.tool);
    }
  });

  it("Hub page contains links to all 3 comparison pages", async () => {
    const res = await fetch(`${BASE}/comparisons`);
    const html = await res.text();
    for (const page of COMPARISON_PAGES) {
      expect(html).toContain(`href="/comparisons/${page.slug}"`);
    }
  });

  for (const page of COMPARISON_PAGES) {
    it(`/${page.slug} contains <h1> with the question`, async () => {
      const res = await fetch(`${BASE}/comparisons/${page.slug}`);
      const html = await res.text();
      expect(html).toContain(page.question);
      expect(html).toMatch(/<h1[^>]*>/);
    });

    it(`/${page.slug} contains feature comparison table`, async () => {
      const res = await fetch(`${BASE}/comparisons/${page.slug}`);
      const html = await res.text();
      expect(html).toContain("Feature comparison");
      expect(html).toContain("<table");
    });

    it(`/${page.slug} contains Article JSON-LD`, async () => {
      const res = await fetch(`${BASE}/comparisons/${page.slug}`);
      const html = await res.text();
      expect(html).toContain('"@type":"Article"');
    });

    it(`/${page.slug} contains breadcrumb JSON-LD with 3 levels`, async () => {
      const res = await fetch(`${BASE}/comparisons/${page.slug}`);
      const html = await res.text();
      expect(html).toContain('"@type":"BreadcrumbList"');
      expect(html).toContain("Home");
      expect(html).toContain("Comparisons");
      expect(html).toContain(page.title);
    });
  }

  it("Sitemap contains all 4 comparison URLs", async () => {
    const res = await fetch(`${BASE}/sitemap.xml`);
    const xml = await res.text();
    expect(xml).toContain("/comparisons");
    expect(xml).toContain("/comparisons/agentbadge-vs-mcp");
    expect(xml).toContain("/comparisons/agentbadge-vs-postman");
    expect(xml).toContain("/comparisons/agentbadge-vs-swagger");
  });
});

describe("SLICE-117-4: Cross-linking from existing pages", () => {
  it("/faq page contains link to /comparisons/agentbadge-vs-swagger", async () => {
    const res = await fetch(`${BASE}/faq`);
    const html = await res.text();
    expect(html).toContain('href="/comparisons/agentbadge-vs-swagger"');
  });

  it("/faq page contains link to /comparisons/agentbadge-vs-postman", async () => {
    const res = await fetch(`${BASE}/faq`);
    const html = await res.text();
    expect(html).toContain('href="/comparisons/agentbadge-vs-postman"');
  });

  it("/faq page contains link to /comparisons/agentbadge-vs-mcp", async () => {
    const res = await fetch(`${BASE}/faq`);
    const html = await res.text();
    expect(html).toContain('href="/comparisons/agentbadge-vs-mcp"');
  });

  it("/rules page contains links to comparison pages", async () => {
    const res = await fetch(`${BASE}/rules`);
    const html = await res.text();
    expect(html).toContain('href="/comparisons/agentbadge-vs-mcp"');
    expect(html).toContain('href="/comparisons/agentbadge-vs-postman"');
    expect(html).toContain('href="/comparisons/agentbadge-vs-swagger"');
  });

  it("All cross-links return 200", async () => {
    const links = [
      "/comparisons/agentbadge-vs-mcp",
      "/comparisons/agentbadge-vs-postman",
      "/comparisons/agentbadge-vs-swagger",
    ];
    for (const link of links) {
      const res = await fetch(`${BASE}${link}`);
      expect(res.status).toBe(200);
    }
  });
});
