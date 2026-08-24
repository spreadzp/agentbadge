import { describe, it, expect, vi } from "vitest";
import { fetchAeoContent } from "../../../src/agent-readiness/scanner/fetchers/aeo-content-fetcher";

describe("SLICE-75-1: aeo-content-fetcher", () => {
  it("detects FAQ schema, definition list, and summary block", async () => {
    const html = `<!DOCTYPE html><html><head>
      <script type="application/ld+json">{"@type":"FAQPage","mainEntity":[]}</script>
    </head><body>
      <div class="short-answer">TL;DR: Agent readiness means APIs are discoverable.</div>
      <dl><dt>Agent</dt><dd>An AI system that acts autonomously</dd></dl>
      <h1>What is Agent Readiness</h1>
      <h2>Introduction</h2>
      <p>Some content here about agent readiness.</p>
    </body></html>`;

    const mockFetch = vi.fn().mockResolvedValue(
      new Response(html, { headers: { "content-type": "text/html" } }),
    );

    const result = await fetchAeoContent("https://example.com/blog/test", mockFetch as unknown as typeof fetch);
    expect(result.source).toBe("aeo-content");
    expect(result.data.hasFaqSchema).toBe(true);
    expect(result.data.hasDefinitionList).toBe(true);
    expect(result.data.hasShortAnswer).toBe(true);
    expect(result.data.hasSummaryBlock).toBe(true);
    expect(result.data.wordCount).toBeGreaterThan(0);
    expect(result.data.headingHierarchy.length).toBeGreaterThan(0);
  });

  it("detects HowTo schema", async () => {
    const html = `<html><head>
      <script type="application/ld+json">{"@type":"HowTo","step":[]}</script>
    </head><body><p>Guide content</p></body></html>`;

    const mockFetch = vi.fn().mockResolvedValue(
      new Response(html, { headers: { "content-type": "text/html" } }),
    );

    const result = await fetchAeoContent("https://example.com/guide", mockFetch as unknown as typeof fetch);
    expect(result.data.hasHowToSchema).toBe(true);
    expect(result.data.hasFaqSchema).toBe(false);
  });

  it("handles fetch error gracefully", async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error("timeout"));
    const result = await fetchAeoContent("https://example.com", mockFetch as unknown as typeof fetch);
    expect(result.data.hasFaqSchema).toBe(false);
    expect(result.data.wordCount).toBe(0);
  });
});
