import { describe, it, expect, vi } from "vitest";
import { fetchInfrastructure } from "../../../src/agent-readiness/scanner/fetchers/infrastructure-fetcher";

describe("SLICE-48-6: infrastructure-fetcher", () => {
  it("detects HTTPS redirect, cache headers, JSON 404, rate limit", async () => {
    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (url.startsWith("http://")) {
        return new Response(null, { status: 301, headers: { location: url.replace("http://", "https://") } });
      }
      if (url.includes("/nonexistent-test-path-404")) {
        return new Response(JSON.stringify({ error: "Not found" }), {
          status: 404,
          headers: { "content-type": "application/json", "x-ratelimit-limit": "100", "x-ratelimit-remaining": "99" },
        });
      }
      return new Response("OK", {
        headers: { "cache-control": "public, max-age=3600", "etag": "abc123" },
      });
    });

    const result = await fetchInfrastructure("https://example.com", mockFetch);
    expect(result.source).toBe("infrastructure");
    expect(result.data.httpsRedirect).toBe(true);
    expect(result.data.cacheHeaders).toBe(true);
    expect(result.data.structuredErrors).toBe(true);
    expect(result.data.rateLimitHeaders).toBe(true);
  });

  it("detects HTML 404", async () => {
    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/nonexistent")) return new Response("<html>404</html>", { status: 404, headers: { "content-type": "text/html" } });
      return new Response("OK");
    });
    const result = await fetchInfrastructure("https://example.com", mockFetch);
    expect(result.data.structuredErrors).toBe(false);
  });
});
