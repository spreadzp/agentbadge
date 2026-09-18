import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("node:dns/promises", () => ({
  resolve4: vi.fn(),
  resolve6: vi.fn(),
}));

import { resolve4, resolve6 } from "node:dns/promises";
import { Hono } from "hono";
import { totalScanRoutes } from "../src/server/routes/total-scan-api";
import { scanPacksApiRoutes } from "../src/server/routes/scan-packs-api";
import { resetConfigCache } from "../src/config/env";
import { BUNDLE_IDS, RULE_BUNDLES, totalPrice, bundlePrice } from "../src/agent-readiness/rule-bundles";

const mockResolve4 = vi.mocked(resolve4);
const mockResolve6 = vi.mocked(resolve6);
const originalEnv = { ...process.env };

beforeEach(() => {
  process.env = { ...originalEnv };
  resetConfigCache();
  vi.stubGlobal("fetch", vi.fn());
  mockResolve4.mockReset();
  mockResolve6.mockReset();
  mockResolve4.mockResolvedValue(["93.184.216.34"]);
  mockResolve6.mockRejectedValue(new Error("no AAAA"));
  vi.mocked(fetch).mockImplementation((async () =>
    new Response("nf", { status: 404, headers: { "content-type": "text/plain" } })) as never);
});

afterEach(() => {
  process.env = { ...originalEnv };
  resetConfigCache();
  vi.unstubAllGlobals();
});

describe("totalPrice unit (SLICE-133-18)", () => {
  it("single light pack → $0.30", () => {
    expect(totalPrice(["discovery-crawling"]).amount).toBe("0.30");
  });

  it("single medium pack → $0.50", () => {
    expect(totalPrice(["payments-x402"]).amount).toBe("0.50");
  });

  it("single heavy pack → $0.90", () => {
    expect(totalPrice(["live-verification"]).amount).toBe("0.90");
  });

  it("multi-pack sums correctly", () => {
    // light 0.30 + medium 0.50 + heavy 0.90 = 1.70
    expect(totalPrice(["discovery-crawling", "payments-x402", "live-verification"]).amount).toBe("1.70");
  });

  it("all 10 packs → FULL_SCAN_PRICE $4.50 (discount)", () => {
    expect(totalPrice([...BUNDLE_IDS]).amount).toBe("4.50");
  });

  it("env override honored", () => {
    process.env.SCAN_PRICE_LIGHT = "0.25";
    expect(bundlePrice(RULE_BUNDLES.find((b) => b.id === "discovery-crawling")!).amount).toBe("0.25");
    expect(totalPrice(["discovery-crawling"]).amount).toBe("0.25");
    delete process.env.SCAN_PRICE_LIGHT;
  });
});

describe("flag matrix (SLICE-133-18)", () => {
  function buildApp(packsEnabled: boolean) {
    if (packsEnabled) process.env.SCAN_PACKS_ENABLED = "true";
    else delete process.env.SCAN_PACKS_ENABLED;
    resetConfigCache();
    const a = new Hono();
    if (packsEnabled) a.route("/api", scanPacksApiRoutes);
    a.route("/api", totalScanRoutes);
    return a;
  }

  it("packs off → /api/scan-packs not registered (404)", async () => {
    const a = buildApp(false);
    const res = await a.request("/api/scan-packs");
    expect(res.status).toBe(404);
  });

  it("packs off → packs param ignored, bogus id still scans", async () => {
    const a = buildApp(false);
    const res = await a.request("/api/total-scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://example.com", packs: ["bogus"] }),
    });
    expect(res.status).toBe(200);
  });

  it("packs on → /api/scan-packs returns catalog", async () => {
    const a = buildApp(true);
    const res = await a.request("/api/scan-packs");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.packs).toHaveLength(10);
  });

  it("packs on → bogus id → 400 with validIds", async () => {
    const a = buildApp(true);
    const res = await a.request("/api/total-scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://example.com", packs: ["bogus"] }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.validIds).toHaveLength(10);
  });
});
