import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import { scanPacksApiRoutes } from "../src/server/routes/scan-packs-api";
import { resetConfigCache } from "../src/config/env";

interface PackEntry {
  id: string;
  name: string;
  helpText: string;
  costClass: string;
  price: { amount: string; currency: string } | null;
  ruleCount: number;
}

describe("GET /api/scan-packs (SLICE-133-14)", () => {
  const originalEnv = { ...process.env };
  let app: Hono;

  beforeEach(() => {
    process.env = { ...originalEnv };
    resetConfigCache();
    app = new Hono();
    app.route("/api", scanPacksApiRoutes);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    resetConfigCache();
  });

  it("returns 10 bundles with helpText + ruleCount", async () => {
    const res = await app.request("/api/scan-packs");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.v).toBe(1);
    expect(body.packs).toHaveLength(10);
    const ids = (body.packs as PackEntry[]).map((p) => p.id);
    expect(ids).toContain("payments-x402");
    expect(ids).toContain("live-verification");
    for (const p of body.packs as PackEntry[]) {
      expect(p.helpText.length).toBeGreaterThan(20);
      expect(p.ruleCount).toBeGreaterThan(0);
      expect(["light", "medium", "heavy"]).toContain(p.costClass);
    }
  });

  it("pricing off → price: null on all entries + fullScan", async () => {
    delete process.env.SCAN_PACK_PRICING_ENABLED;
    resetConfigCache();
    const res = await app.request("/api/scan-packs");
    const body = await res.json();
    for (const p of body.packs) expect(p.price).toBeNull();
    expect(body.fullScan.price).toBeNull();
    expect(body.fullScan.ruleCount).toBeGreaterThan(0);
  });

  it("pricing on → real prices + env overrides applied", async () => {
    process.env.SCAN_PACK_PRICING_ENABLED = "true";
    process.env.SCAN_PRICE_LIGHT = "0.15";
    resetConfigCache();
    const res = await app.request("/api/scan-packs");
    const body = await res.json();
    const light = (body.packs as PackEntry[]).find((p) => p.costClass === "light");
    const heavy = (body.packs as PackEntry[]).find((p) => p.costClass === "heavy");
    expect(light.price).toEqual({ amount: "0.15", currency: "USDC" });
    expect(heavy.price).toEqual({ amount: "0.90", currency: "USDC" });
    expect(body.fullScan.price).toEqual({ amount: "4.50", currency: "USDC" });
  });

  it("Cache-Control header set", async () => {
    const res = await app.request("/api/scan-packs");
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=300");
  });
});
