import { describe, it, expect } from "vitest";
import { COMPARISON_PAGES, getComparisonPage } from "../../../src/server/lib/comparison-data";
import { ComparisonPage } from "../../../src/views/comparison-page";
import { ComparisonHubPage } from "../../../src/views/comparison-hub-page";

describe("SLICE-117-1: comparison-data", () => {
  it("getComparisonPage('agentbadge-vs-mcp') returns ComparisonPageData", () => {
    const page = getComparisonPage("agentbadge-vs-mcp");
    expect(page).toBeDefined();
    expect(page!.slug).toBe("agentbadge-vs-mcp");
    expect(page!.tool).toContain("MCP");
  });

  it("getComparisonPage('invalid') returns undefined", () => {
    const page = getComparisonPage("invalid-slug");
    expect(page).toBeUndefined();
  });

  it("COMPARISON_PAGES has 3 entries", () => {
    expect(COMPARISON_PAGES).toHaveLength(3);
  });

  it("all relatedPages slugs exist in COMPARISON_PAGES", () => {
    const allSlugs = new Set(COMPARISON_PAGES.map((p) => p.slug));
    for (const page of COMPARISON_PAGES) {
      for (const relatedSlug of page.relatedPages) {
        expect(allSlugs.has(relatedSlug)).toBe(true);
      }
    }
  });
});

describe("SLICE-117-1: ComparisonPage view", () => {
  it("returns HTML with H1 question", () => {
    const data = COMPARISON_PAGES[0];
    const html = ComparisonPage(data, "<p>Markdown content</p>").toString();
    expect(html).toContain(data.question);
    expect(html).toMatch(/<h1[^>]*>/);
  });

  it("HTML contains feature comparison table with tool name", () => {
    const data = COMPARISON_PAGES[0];
    const html = ComparisonPage(data, "<p>test</p>").toString();
    expect(html).toContain("Feature comparison");
    expect(html).toContain(data.tool);
    expect(html).toContain("<table");
  });

  it("HTML contains verdict section", () => {
    const data = COMPARISON_PAGES[1];
    const html = ComparisonPage(data, "<p>test</p>").toString();
    expect(html).toContain("Verdict");
    expect(html).toContain(data.verdict);
  });

  it("HTML contains CTA link to /#scan", () => {
    const data = COMPARISON_PAGES[0];
    const html = ComparisonPage(data, "<p>test</p>").toString();
    expect(html).toContain('href="/#scan"');
  });

  it("HTML contains breadcrumb nav", () => {
    const data = COMPARISON_PAGES[0];
    const html = ComparisonPage(data, "<p>test</p>").toString();
    expect(html).toContain('href="/comparisons"');
    expect(html).toContain("Comparisons");
  });

  it("HTML contains related comparison links", () => {
    const data = COMPARISON_PAGES[0];
    const html = ComparisonPage(data, "<p>test</p>").toString();
    expect(html).toContain("Other comparisons");
    expect(html).toContain('href="/comparisons/agentbadge-vs-postman"');
  });
});

describe("SLICE-117-1: ComparisonHubPage view", () => {
  it("returns HTML with overview table", () => {
    const html = ComparisonHubPage().toString();
    expect(html).toContain("Overview");
    expect(html).toContain("<table");
  });

  it("Hub HTML contains links to all 3 comparison pages", () => {
    const html = ComparisonHubPage().toString();
    for (const page of COMPARISON_PAGES) {
      expect(html).toContain(`href="/comparisons/${page.slug}"`);
    }
  });

  it("Hub HTML contains H1 with comparison heading", () => {
    const html = ComparisonHubPage().toString();
    expect(html).toMatch(/<h1[^>]*>[^<]*AgentBadge vs Other Tools/);
  });

  it("Hub HTML contains CTA link to /#scan", () => {
    const html = ComparisonHubPage().toString();
    expect(html).toContain('href="/#scan"');
  });

  it("Hub HTML contains all 3 tool names in table headers", () => {
    const html = ComparisonHubPage().toString();
    for (const page of COMPARISON_PAGES) {
      expect(html).toContain(page.tool);
    }
  });
});
