import { describe, it, expect, vi } from "vitest";
import { fetchHomepageMeta } from "../../../src/agent-readiness/scanner/fetchers/homepage-meta-fetcher";

describe("SLICE-48-4: homepage-meta-fetcher", () => {
  it("parses JSON-LD, og:image, canonical, favicon from HTML", async () => {
    const html = `<!DOCTYPE html><html><head>
      <script type="application/ld+json">{"@type":"Organization","sameAs":["https://github.com/foo"]}</script>
      <meta property="og:image" content="https://example.com/og.png">
      <meta name="twitter:card" content="summary_large_image">
      <link rel="icon" type="image/svg+xml" href="/icon.svg">
      <link rel="icon" type="image/png" href="/icon.png">
      <link rel="canonical" href="https://example.com/">
      <link rel="alternate" type="text/plain" href="/llms.txt">
    </head><body></body></html>`;

    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (url.endsWith("/og.png")) return new Response("png", { status: 200 });
      return new Response(html, { headers: { "content-type": "text/html" } });
    });

    const result = await fetchHomepageMeta("https://example.com", mockFetch);
    expect(result.source).toBe("homepage-meta");
    expect(result.data.jsonLd).toHaveLength(1);
    expect(result.data.ogImage).toBe("https://example.com/og.png");
    expect(result.data.ogImageReachable).toBe(true);
    expect(result.data.twitterCard).toBe("summary_large_image");
    expect(result.data.faviconSvg).toBe(true);
    expect(result.data.faviconPng).toBe(true);
    expect(result.data.canonical).toBe("https://example.com/");
    expect(result.data.llmsTxtLinked).toBe(true);
  });

  it("handles empty homepage", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response("<html></html>", { headers: { "content-type": "text/html" } }),
    );
    const result = await fetchHomepageMeta("https://example.com", mockFetch);
    expect(result.data.jsonLd).toEqual([]);
    expect(result.data.ogImage).toBeNull();
  });
});
