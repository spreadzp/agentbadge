import { describe, it, expect, vi } from "vitest";
import { fetchOgMeta } from "../../../src/agent-readiness/scanner/fetchers/og-meta-fetcher";

describe("SLICE-75-1: og-meta-fetcher", () => {
  it("parses OG article tags from HTML", async () => {
    const html = `<!DOCTYPE html><html><head>
      <meta property="og:type" content="article">
      <meta property="og:title" content="What is Agent Readiness">
      <meta property="og:image" content="https://example.com/og.png">
      <meta property="og:image:alt" content="Agent Readiness Diagram">
      <meta property="article:author" content="https://example.com/author">
      <meta property="article:published_time" content="2026-08-01T00:00:00Z">
      <meta property="article:modified_time" content="2026-08-10T00:00:00Z">
      <meta property="og:url" content="https://example.com/blog/test">
      <meta property="og:site_name" content="AgentBadge">
    </head><body></body></html>`;

    const mockFetch = vi.fn().mockResolvedValue(
      new Response(html, { headers: { "content-type": "text/html" } }),
    );

    const result = await fetchOgMeta("https://example.com/blog/test", mockFetch as unknown as typeof fetch);
    expect(result.source).toBe("og-meta");
    expect(result.data.ogType).toBe("article");
    expect(result.data.ogImageAlt).toBe("Agent Readiness Diagram");
    expect(result.data.articleAuthor).toBe("https://example.com/author");
    expect(result.data.articlePublishedTime).toBe("2026-08-01T00:00:00Z");
    expect(result.data.articleModifiedTime).toBe("2026-08-10T00:00:00Z");
    expect(result.data.ogTitle).toBe("What is Agent Readiness");
    expect(result.data.ogSiteName).toBe("AgentBadge");
  });

  it("handles empty page", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response("<html></html>", { headers: { "content-type": "text/html" } }),
    );
    const result = await fetchOgMeta("https://example.com", mockFetch as unknown as typeof fetch);
    expect(result.data.ogType).toBeNull();
    expect(result.data.ogImageAlt).toBeNull();
  });

  it("handles fetch error gracefully", async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error("network error"));
    const result = await fetchOgMeta("https://example.com", mockFetch as unknown as typeof fetch);
    expect(result.data.ogType).toBeNull();
    expect(result.data.ogTitle).toBeNull();
  });
});
