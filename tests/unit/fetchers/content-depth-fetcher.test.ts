import { describe, it, expect, vi } from "vitest";
import { fetchContentDepth } from "../../../src/agent-readiness/scanner/fetchers/content-depth-fetcher";

describe("SLICE-75-1: content-depth-fetcher", () => {
  it("counts words, paragraphs, headings, and links", async () => {
    const html = `<!DOCTYPE html><html><body>
      <div id="toc" class="table-of-contents"><ul><li><a href="#sec1">Section 1</a></li></ul></div>
      <h1>Main Title</h1>
      <h2>Section 1</h2>
      <p>This is a paragraph about agent readiness and API discovery.</p>
      <p>Another paragraph with more content about the topic.</p>
      <h3>Subsection</h3>
      <p>More details here.</p>
      <a href="/blog/other">Internal link</a>
      <a href="https://external.com">External link</a>
      <a href="#section1">Anchor link</a>
    </body></html>`;

    const mockFetch = vi.fn().mockResolvedValue(
      new Response(html, { headers: { "content-type": "text/html" } }),
    );

    const result = await fetchContentDepth("https://example.com/blog/test", mockFetch as unknown as typeof fetch);
    expect(result.source).toBe("content-depth");
    expect(result.data.wordCount).toBeGreaterThan(0);
    expect(result.data.paragraphCount).toBe(3);
    expect(result.data.headingCount).toBe(3);
    expect(result.data.headingHierarchy).toEqual([
      { level: 1, text: "Main Title" },
      { level: 2, text: "Section 1" },
      { level: 3, text: "Subsection" },
    ]);
    expect(result.data.hasTableOfContents).toBe(true);
    expect(result.data.hasInternalLinks).toBeGreaterThanOrEqual(2);
    expect(result.data.hasExternalLinks).toBeGreaterThanOrEqual(1);
  });

  it("handles page with no content", async () => {
    const html = `<html><body></body></html>`;
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(html, { headers: { "content-type": "text/html" } }),
    );

    const result = await fetchContentDepth("https://example.com", mockFetch as unknown as typeof fetch);
    expect(result.data.wordCount).toBe(0);
    expect(result.data.paragraphCount).toBe(0);
    expect(result.data.headingCount).toBe(0);
    expect(result.data.hasInternalLinks).toBe(0);
    expect(result.data.hasExternalLinks).toBe(0);
  });

  it("handles fetch error gracefully", async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error("timeout"));
    const result = await fetchContentDepth("https://example.com", mockFetch as unknown as typeof fetch);
    expect(result.data.wordCount).toBe(0);
    expect(result.data.headingHierarchy).toEqual([]);
  });
});
