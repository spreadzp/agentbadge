import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("node:dns/promises", () => ({
  resolve4: vi.fn(),
  resolve6: vi.fn(),
}));

import { resolve4, resolve6 } from "node:dns/promises";
import { fetchRobotsTxt } from "../src/agent-readiness/scanner/fetchers/robots-fetcher";
import { fetchSitemapXml } from "../src/agent-readiness/scanner/fetchers/sitemap-fetcher";
import { fetchAgentGuide } from "../src/agent-readiness/scanner/fetchers/guide-fetcher";
import { fetchOpenApi } from "../src/agent-readiness/scanner/fetchers/openapi-fetcher";
import { fetchMcpDescriptor } from "../src/agent-readiness/scanner/fetchers/mcp-fetcher";

const mockResolve4 = vi.mocked(resolve4);
const mockResolve6 = vi.mocked(resolve6);

function mockResponse(status: number, body: string, headers: Record<string, string> = {}) {
  const bodyBytes = new TextEncoder().encode(body);
  return {
    status,
    headers: new Headers(headers),
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(bodyBytes);
        controller.close();
      },
    }),
  } as Response;
}

function mockRedirect(location: string) {
  return mockResponse(302, "", { location });
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
  mockResolve4.mockReset();
  mockResolve6.mockReset();
  mockResolve4.mockResolvedValue(["93.184.216.34"]);
  mockResolve6.mockRejectedValue(new Error("no AAAA"));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchRobotsTxt", () => {
  it("fetches /robots.txt and returns body + hash", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      mockResponse(200, "User-agent: *\nDisallow: /", { "content-type": "text/plain" }),
    );
    const result = await fetchRobotsTxt("https://example.com");
    expect(result.status).toBe(200);
    expect(result.body).toContain("User-agent");
    expect(result.bodyHash).toBeTruthy();
    expect(result.url).toBe("https://example.com/robots.txt");
  });

  it("returns status 0 on fetch failure", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error("network"));
    const result = await fetchRobotsTxt("https://example.com");
    expect(result.status).toBe(0);
    expect(result.body).toBeNull();
  });
});

describe("fetchSitemapXml", () => {
  it("fetches /sitemap.xml and returns body", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      mockResponse(200, "<urlset></urlset>", { "content-type": "application/xml" }),
    );
    const result = await fetchSitemapXml("https://example.com");
    expect(result.status).toBe(200);
    expect(result.body).toContain("urlset");
    expect(result.bodyHash).toBeTruthy();
  });

  it("returns status 0 on failure", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error("network"));
    const result = await fetchSitemapXml("https://example.com");
    expect(result.status).toBe(0);
  });
});

describe("fetchAgentGuide", () => {
  it("finds guide at /.well-known/agent-guide.json", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      mockResponse(200, '{"name":"test"}', { "content-type": "application/json" }),
    );
    const result = await fetchAgentGuide("https://example.com");
    expect(result.status).toBe(200);
    expect(result.path).toBe("/.well-known/agent-guide.json");
    expect(result.bodyHash).toBeTruthy();
  });

  it("falls back to /agent-guide.json", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse(404, ""));
    vi.mocked(fetch).mockResolvedValueOnce(
      mockResponse(200, '{"name":"test"}', { "content-type": "application/json" }),
    );
    const result = await fetchAgentGuide("https://example.com");
    expect(result.status).toBe(200);
    expect(result.path).toBe("/agent-guide.json");
  });

  it("returns 404 when no path found", async () => {
    vi.mocked(fetch).mockResolvedValue(mockResponse(404, ""));
    const result = await fetchAgentGuide("https://example.com");
    expect(result.status).toBe(404);
    expect(result.path).toBeNull();
  });
});

describe("fetchOpenApi", () => {
  it("finds spec at /openapi.json", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      mockResponse(200, '{"openapi":"3.0"}', { "content-type": "application/json" }),
    );
    const result = await fetchOpenApi("https://example.com");
    expect(result.status).toBe(200);
    expect(result.path).toBe("/openapi.json");
    expect(result.format).toBe("json");
  });

  it("falls back to /swagger.json", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse(404, ""));
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse(404, ""));
    vi.mocked(fetch).mockResolvedValueOnce(
      mockResponse(200, '{"swagger":"2.0"}', { "content-type": "application/json" }),
    );
    const result = await fetchOpenApi("https://example.com");
    expect(result.status).toBe(200);
    expect(result.path).toBe("/swagger.json");
  });

  it("continues on 5xx to next path", async () => {
    // /openapi.json returns 500, safeFetch retries → 500 again
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse(500, ""));
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse(500, ""));
    // /openapi.yaml returns 404
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse(404, ""));
    // /swagger.json returns 200
    vi.mocked(fetch).mockResolvedValueOnce(
      mockResponse(200, '{"swagger":"2.0"}', { "content-type": "application/json" }),
    );
    const result = await fetchOpenApi("https://example.com");
    expect(result.status).toBe(200);
    expect(result.path).toBe("/swagger.json");
  });

  it("returns 404 when all paths fail", async () => {
    vi.mocked(fetch).mockResolvedValue(mockResponse(404, ""));
    const result = await fetchOpenApi("https://example.com");
    expect(result.status).toBe(404);
    expect(result.path).toBeNull();
    expect(result.format).toBeNull();
  });
});

describe("fetchMcpDescriptor", () => {
  it("fetches /.well-known/mcp.json and returns body", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      mockResponse(200, '{"version":"1"}', { "content-type": "application/json" }),
    );
    const result = await fetchMcpDescriptor("https://example.com");
    expect(result.status).toBe(200);
    expect(result.body).toContain("version");
    expect(result.bodyHash).toBeTruthy();
    expect(result.parseError).toBeNull();
  });

  it("returns 404 without throwing", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse(404, ""));
    const result = await fetchMcpDescriptor("https://example.com");
    expect(result.status).toBe(404);
    expect(result.body).toBeNull();
  });

  it("returns parseError for invalid JSON", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      mockResponse(200, "not json", { "content-type": "application/json" }),
    );
    const result = await fetchMcpDescriptor("https://example.com");
    expect(result.status).toBe(200);
    expect(result.parseError).toBe("invalid_json");
  });
});
