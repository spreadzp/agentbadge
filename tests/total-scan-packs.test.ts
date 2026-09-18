import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("node:dns/promises", () => ({
  resolve4: vi.fn(),
  resolve6: vi.fn(),
}));

import { resolve4, resolve6 } from "node:dns/promises";
import { Hono } from "hono";
import { totalScanRoutes } from "../src/server/routes/total-scan-api";
import { resetConfigCache } from "../src/config/env";

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

const originalEnv = { ...process.env };
let app: Hono;

beforeEach(() => {
  process.env = { ...originalEnv };
  process.env.SCAN_PACKS_ENABLED = "true";
  resetConfigCache();
  app = new Hono();
  app.route("/api", totalScanRoutes);
  vi.stubGlobal("fetch", vi.fn());
  mockResolve4.mockReset();
  mockResolve6.mockReset();
  mockResolve4.mockResolvedValue(["93.184.216.34"]);
  mockResolve6.mockRejectedValue(new Error("no AAAA"));
  vi.mocked(fetch).mockImplementation((async () =>
    mockResponse(404, "nf", { "content-type": "text/plain" })) as never);
});

afterEach(() => {
  process.env = { ...originalEnv };
  resetConfigCache();
  vi.unstubAllGlobals();
});

describe("POST /api/total-scan packs param (SLICE-133-15)", () => {
  it("{packs: ['bogus']} → 400 with validIds", async () => {
    const res = await app.request("/api/total-scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://example.com", packs: ["bogus"] }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("bogus");
    expect(body.unknown).toEqual(["bogus"]);
    expect(body.validIds).toContain("payments-x402");
    expect(body.validIds).toHaveLength(10);
  });

  it("{packs: ['discovery-crawling']} → scoped SSE scan", async () => {
    const res = await app.request("/api/total-scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://example.com", packs: ["discovery-crawling"] }),
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("event: result");
    // scoped fetch → 13 resources + 2 evaluating events (vs 47+2 full)
    const progressEvents = text.match(/event: progress/g) ?? [];
    expect(progressEvents.length).toBeGreaterThan(0);
    expect(progressEvents.length).toBeLessThan(20);
  });

  it("{packs: ['safety']} legacy alias → resolves, no 400", async () => {
    const res = await app.request("/api/total-scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://example.com", packs: ["safety"] }),
    });
    expect(res.status).toBe(200);
  });

  it("flag off → packs silently ignored (full scan, no 400)", async () => {
    delete process.env.SCAN_PACKS_ENABLED;
    resetConfigCache();
    const res = await app.request("/api/total-scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://example.com", packs: ["bogus"] }),
    });
    expect(res.status).toBe(200);
  });

  it("packs not array of strings → 400", async () => {
    const res = await app.request("/api/total-scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://example.com", packs: [1, 2] }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("array of strings");
  });
});
