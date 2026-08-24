import { describe, it, expect, vi } from "vitest";
import { fetchSemanticHtml } from "../../../src/agent-readiness/scanner/fetchers/semantic-html-fetcher";

describe("SLICE-75-1: semantic-html-fetcher", () => {
  it("detects semantic HTML5 tags and breadcrumbs", async () => {
    const html = `<!DOCTYPE html><html><body>
      <nav class="breadcrumb"><a href="/">Home</a> > <a href="/blog">Blog</a></nav>
      <article>
        <header><h1>Article Title</h1></header>
        <time datetime="2026-08-01">August 1, 2026</time>
        <figure><img src="diagram.png" alt="Diagram"><figcaption>Figure 1: Architecture</figcaption></figure>
      </article>
      <dl><dt>Term</dt><dd>Definition</dd></dl>
    </body></html>`;

    const mockFetch = vi.fn().mockResolvedValue(
      new Response(html, { headers: { "content-type": "text/html" } }),
    );

    const result = await fetchSemanticHtml("https://example.com/blog/test", mockFetch as unknown as typeof fetch);
    expect(result.source).toBe("semantic-html");
    expect(result.data.hasArticleTag).toBe(true);
    expect(result.data.hasTimeTag).toBe(true);
    expect(result.data.hasNavTag).toBe(true);
    expect(result.data.hasBreadcrumbs).toBe(true);
    expect(result.data.hasFigureCaption).toBe(true);
    expect(result.data.hasDefinitionList).toBe(true);
    expect(result.data.definitionListCount).toBe(1);
  });

  it("detects BreadcrumbList JSON-LD", async () => {
    const html = `<html><head>
      <script type="application/ld+json">{"@type":"BreadcrumbList","itemListElement":[]}</script>
    </head><body></body></html>`;

    const mockFetch = vi.fn().mockResolvedValue(
      new Response(html, { headers: { "content-type": "text/html" } }),
    );

    const result = await fetchSemanticHtml("https://example.com", mockFetch as unknown as typeof fetch);
    expect(result.data.hasBreadcrumbs).toBe(true);
  });

  it("handles fetch error gracefully", async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error("timeout"));
    const result = await fetchSemanticHtml("https://example.com", mockFetch as unknown as typeof fetch);
    expect(result.data.hasArticleTag).toBe(false);
    expect(result.data.definitionListCount).toBe(0);
  });
});
