/**
 * SLICE-130-7: GA4 pageview tracking middleware tests.
 *
 * Verifies that:
 * - HTML 200 GET responses trigger trackPageView (fire-and-forget)
 * - API routes (/api/*) do NOT trigger tracking
 * - Non-HTML responses (JSON, XML) do NOT trigger tracking
 * - Disabled GA4 → zero behavior change
 */

import { describe, it, expect, beforeAll, vi } from "vitest";

process.env.MOCK_HEDERA = "true";
process.env.PASSPORT_TOKEN_ID = "0.0.1234567";
process.env.HEDERA_OPERATOR_ID = "0.0.1001";
process.env.HEDERA_OPERATOR_KEY = "test-key";
process.env.AUDIT_TOPIC_ID = "0.0.1003";
process.env.DIRECTORY_TOPIC_ID = "0.0.1004";
process.env["x402_FACILITATOR_URL"] = "https://facilitator.example.com";
process.env["x402_FEE_PAYER"] = "0.0.1005";
process.env["x402_TREASURY"] = "0.0.1006";
process.env.IPFS_API_KEY = "test-ipfs-key";
process.env.IPFS_API_SECRET = "test-ipfs-secret";
delete process.env.KEEPERHUB_ENABLED;
delete process.env.ATTESTCOIN_ENABLED;

// Mock trackPageView before importing the app
const trackPageViewMock = vi.fn();
vi.mock("../../src/server/lib/google-analytics", () => ({
  isGa4Enabled: () => process.env.GA4_ENABLED === "true",
  trackPageView: (...args: unknown[]) => trackPageViewMock(...args),
  trackEvent: vi.fn(),
}));

// Prevent Bun.serve from binding a port during test import
const bunGlobal = (globalThis as Record<string, unknown>).Bun ?? {};
vi.stubGlobal("Bun", {
  ...bunGlobal,
  serve: vi.fn(() => ({ hostname: "localhost", port: 0 })),
});

const { createApp } = await import("../../src/server/index");

describe("SLICE-130-7: GA4 pageview middleware", () => {
  let app: ReturnType<typeof createApp>;

  beforeAll(() => {
    app = createApp();
  });

  it("GET / (HTML 200) triggers trackPageView when GA4 enabled", async () => {
    process.env.GA4_ENABLED = "true";
    trackPageViewMock.mockClear();

    const res = await app.request("/");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")?.includes("text/html")).toBe(true);

    // Wait a tick for fire-and-forget
    await new Promise((r) => setTimeout(r, 50));

    expect(trackPageViewMock).toHaveBeenCalledTimes(1);
    const [path] = trackPageViewMock.mock.calls[0];
    expect(path).toBe("/");
  });

  it("GET /api/health (JSON) does NOT trigger trackPageView", async () => {
    process.env.GA4_ENABLED = "true";
    trackPageViewMock.mockClear();

    const res = await app.request("/api/health");
    expect(res.status).toBe(200);

    await new Promise((r) => setTimeout(r, 50));
    expect(trackPageViewMock).not.toHaveBeenCalled();
  });

  it("GET /health (JSON) does NOT trigger trackPageView", async () => {
    process.env.GA4_ENABLED = "true";
    trackPageViewMock.mockClear();

    await app.request("/health");

    await new Promise((r) => setTimeout(r, 50));
    expect(trackPageViewMock).not.toHaveBeenCalled();
  });

  it("GET /openapi.json (JSON) does NOT trigger trackPageView", async () => {
    process.env.GA4_ENABLED = "true";
    trackPageViewMock.mockClear();

    await app.request("/openapi.json");

    await new Promise((r) => setTimeout(r, 50));
    expect(trackPageViewMock).not.toHaveBeenCalled();
  });

  it("GA4 disabled → trackPageView not called even for HTML pages", async () => {
    delete process.env.GA4_ENABLED;
    trackPageViewMock.mockClear();

    const res = await app.request("/");
    expect(res.status).toBe(200);

    await new Promise((r) => setTimeout(r, 50));
    expect(trackPageViewMock).not.toHaveBeenCalled();
  });

  it("response is not delayed by analytics (fire-and-forget)", async () => {
    process.env.GA4_ENABLED = "true";
    trackPageViewMock.mockClear();

    // Make trackPageView slow — response should still return immediately
    trackPageViewMock.mockImplementation(
      () => new Promise((r) => setTimeout(r, 500)),
    );

    const start = Date.now();
    const res = await app.request("/");
    const elapsed = Date.now() - start;

    expect(res.status).toBe(200);
    expect(elapsed).toBeLessThan(300); // response returns well before the 500ms mock

    // Restore normal mock
    trackPageViewMock.mockImplementation(() => Promise.resolve());
  });
});
