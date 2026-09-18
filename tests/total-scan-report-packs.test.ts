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

const originalEnv = { ...process.env };
let app: Hono;

function parseSseResult(text: string): Record<string, unknown> | null {
  const match = text.match(/event: result\ndata: (.+)\n/);
  return match ? JSON.parse(match[1]) : null;
}

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
    new Response("nf", { status: 404, headers: { "content-type": "text/plain" } })) as never);
});

afterEach(() => {
  process.env = { ...originalEnv };
  resetConfigCache();
  vi.unstubAllGlobals();
});

describe("SSE result event pack-scoped fields (SLICE-133-17)", () => {
  it("pack scan → result has bundles + bundleScores + upsell", async () => {
    const res = await app.request("/api/total-scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://example.com", packs: ["payments-x402"] }),
    });
    expect(res.status).toBe(200);
    const report = parseSseResult(await res.text());
    expect(report).not.toBeNull();
    expect(report!.bundles).toEqual(["payments-x402"]);
    expect(report!.bundleScores).toBeDefined();
    expect(report!.upsell).toBeDefined();
    const upsell = report!.upsell as { notChecked: Array<{ id: string; price: { amount: string } }>; fullScanPrice: { amount: string } };
    expect(upsell.notChecked.length).toBe(9);
    expect(upsell.notChecked.map((b) => b.id)).not.toContain("payments-x402");
    expect(upsell.fullScanPrice.amount).toBe("4.50");
  });

  it("formatScanReport without packs → no bundles/bundleScores/upsell", async () => {
    // Unit-level check: full scan path calls formatScanReport without
    // opts.packs → additive fields absent (SSE full scan is too slow
    // for a 5s test budget — 47 resources through the rate limiter).
    const { formatScanReport } = await import("../src/agent-readiness/report-formatter");
    const { RuleEngine } = await import("../src/agent-readiness/rule-engine/rule-engine");
    const emptyState = { domain: "example.com", scannedAt: new Date().toISOString(), snapshots: {} } as never;
    const result = RuleEngine.run(emptyState);
    const report = formatScanReport("https://example.com", result);
    expect(report.bundles).toBeUndefined();
    expect(report.bundleScores).toBeUndefined();
    expect(report.upsell).toBeUndefined();
  });
});
