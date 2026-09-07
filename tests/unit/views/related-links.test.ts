import { describe, it, expect } from "vitest";
import { RelatedLinks, type RelatedLinkItem } from "../../../src/views/related-links";
import { RelatedArticles } from "../../../src/views/related-articles";

describe("SLICE-113-1: RelatedLinks component", () => {
  it("renders correct HTML with title, links, descriptions", () => {
    const links: RelatedLinkItem[] = [
      { label: "Scanner", href: "/services/scanner", description: "Scan your API" },
      { label: "Agent Guide", href: "/agent-guide", description: "How to prepare" },
    ];
    const html = RelatedLinks("Related Tools", links);
    expect(html).toContain("Related Tools");
    expect(html).toContain('href="/services/scanner"');
    expect(html).toContain("Scanner");
    expect(html).toContain("Scan your API");
    expect(html).toContain('href="/agent-guide"');
    expect(html).toContain("Agent Guide");
    expect(html).toContain("How to prepare");
  });

  it("renders without description block when description is omitted", () => {
    const links: RelatedLinkItem[] = [
      { label: "Pricing", href: "/#pricing" },
    ];
    const html = RelatedLinks("Quick Links", links);
    expect(html).toContain("Pricing");
    expect(html).toContain('href="/#pricing"');
    expect(html).not.toContain('<p class="mt-1 text-xs text-slate-400">');
  });

  it("renders nothing for empty links array", () => {
    const html = RelatedLinks("Empty", []);
    expect(html).toBe("");
  });
});

describe("SLICE-113-1: RelatedArticles component", () => {
  it("renders correct HTML with article cards", () => {
    const articles = [
      {
        slug: "what-is-agent-readiness",
        title: "What is Agent Readiness?",
        description: "A guide to making APIs agent-friendly",
        date: "2025-01-15",
        readingTime: "8 min",
      },
      {
        slug: "mcp-explained",
        title: "MCP Explained",
        description: "Understanding the Model Context Protocol",
        date: "2025-02-01",
        readingTime: "5 min",
      },
    ];
    const html = RelatedArticles(articles);
    expect(html).toContain("Related Articles");
    expect(html).toContain('href="/blog/what-is-agent-readiness"');
    expect(html).toContain("What is Agent Readiness?");
    expect(html).toContain("A guide to making APIs agent-friendly");
    expect(html).toContain("2025-01-15");
    expect(html).toContain("8 min");
    expect(html).toContain('href="/blog/mcp-explained"');
    expect(html).toContain("MCP Explained");
  });

  it("renders nothing for empty articles array", () => {
    const html = RelatedArticles([]);
    expect(html).toBe("");
  });
});
