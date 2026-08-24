import { describe, it, expect, vi } from "vitest";
import { fetchAccessibility } from "../../../src/agent-readiness/scanner/fetchers/accessibility-fetcher";

describe("SLICE-75-1: accessibility-fetcher", () => {
  it("counts images with and without alt, and lazy loading", async () => {
    const html = `<!DOCTYPE html><html><body>
      <img src="img1.png" alt="Description 1" loading="lazy">
      <img src="img2.png" alt="Description 2">
      <img src="img3.png" loading="lazy">
      <a href="#main" class="skip-link">Skip to content</a>
      <button aria-label="Close menu">X</button>
    </body></html>`;

    const mockFetch = vi.fn().mockResolvedValue(
      new Response(html, { headers: { "content-type": "text/html" } }),
    );

    const result = await fetchAccessibility("https://example.com", mockFetch as unknown as typeof fetch);
    expect(result.source).toBe("accessibility");
    expect(result.data.totalImages).toBe(3);
    expect(result.data.imagesWithAlt).toBe(2);
    expect(result.data.imagesWithoutAlt).toBe(1);
    expect(result.data.imagesWithLazyLoading).toBe(2);
    expect(result.data.hasAriaLabels).toBe(true);
    expect(result.data.hasSkipLink).toBe(true);
  });

  it("handles page with no images", async () => {
    const html = `<html><body><p>No images here</p></body></html>`;
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(html, { headers: { "content-type": "text/html" } }),
    );

    const result = await fetchAccessibility("https://example.com", mockFetch as unknown as typeof fetch);
    expect(result.data.totalImages).toBe(0);
    expect(result.data.imagesWithAlt).toBe(0);
    expect(result.data.imagesWithoutAlt).toBe(0);
  });

  it("handles fetch error gracefully", async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error("timeout"));
    const result = await fetchAccessibility("https://example.com", mockFetch as unknown as typeof fetch);
    expect(result.data.totalImages).toBe(0);
    expect(result.data.hasAriaLabels).toBe(false);
  });
});
