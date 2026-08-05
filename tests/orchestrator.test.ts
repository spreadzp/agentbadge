import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("node:dns/promises", () => ({
  resolve4: vi.fn(),
  resolve6: vi.fn(),
}));

import { resolve4, resolve6 } from "node:dns/promises";
import { scanDomain } from "../src/agent-readiness/scanner/orchestrator";

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

describe("scanDomain", () => {
  it("returns SourceState with 5 snapshots", async () => {
    vi.mocked(fetch).mockImplementation(async (url: string) => {
      const u = String(url);
      if (u.includes("robots.txt")) return mockResponse(200, "User-agent: *", { "content-type": "text/plain" });
      if (u.includes("sitemap.xml")) return mockResponse(200, "<urlset/>", { "content-type": "application/xml" });
      if (u.includes("agent-guide")) return mockResponse(200, '{"name":"test"}', { "content-type": "application/json" });
      if (u.includes("openapi")) return mockResponse(200, '{"openapi":"3.0"}', { "content-type": "application/json" });
      if (u.includes("mcp.json")) return mockResponse(200, '{"version":"1"}', { "content-type": "application/json" });
      return mockResponse(404, "");
    });

    const state = await scanDomain("https://example.com");
    expect(state.domain).toBe("example.com");
    expect(state.scannedAt).toBeTruthy();
    expect(Object.keys(state.snapshots)).toHaveLength(5);
    expect(state.snapshots.robots).not.toBeNull();
    expect(state.snapshots.sitemap).not.toBeNull();
    expect(state.snapshots.guide).not.toBeNull();
    expect(state.snapshots.openapi).not.toBeNull();
    expect(state.snapshots.mcp).not.toBeNull();
  });

  it("with resources filter only fetches specified", async () => {
    vi.mocked(fetch).mockImplementation(async (url: string) => {
      const u = String(url);
      if (u.includes("robots.txt")) return mockResponse(200, "User-agent: *", { "content-type": "text/plain" });
      if (u.includes("openapi")) return mockResponse(200, '{"openapi":"3.0"}', { "content-type": "application/json" });
      return mockResponse(404, "");
    });

    const state = await scanDomain("https://example.com", { resources: ["robots", "openapi"] });
    expect(Object.keys(state.snapshots)).toHaveLength(2);
    expect(state.snapshots.robots).not.toBeNull();
    expect(state.snapshots.openapi).not.toBeNull();
    expect(state.snapshots.sitemap).toBeUndefined();
  });

  it("throws on invalid URL protocol", async () => {
    await expect(scanDomain("ftp://example.com")).rejects.toThrow(/Invalid URL protocol/);
  });

  it("with noCache bypasses cache", async () => {
    vi.mocked(fetch).mockImplementation(async (url: string) => {
      const u = String(url);
      if (u.includes("robots.txt")) return mockResponse(200, "User-agent: *", { "content-type": "text/plain" });
      if (u.includes("sitemap.xml")) return mockResponse(200, "<urlset/>", { "content-type": "application/xml" });
      if (u.includes("agent-guide")) return mockResponse(200, '{"name":"test"}', { "content-type": "application/json" });
      if (u.includes("openapi")) return mockResponse(200, '{"openapi":"3.0"}', { "content-type": "application/json" });
      if (u.includes("mcp.json")) return mockResponse(200, '{"version":"1"}', { "content-type": "application/json" });
      return mockResponse(404, "");
    });

    const state = await scanDomain("https://example.com", { noCache: true });
    expect(state.domain).toBe("example.com");
  });
});
