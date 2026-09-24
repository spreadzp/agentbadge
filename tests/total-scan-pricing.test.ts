import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("node:dns/promises", () => ({
  resolve4: vi.fn(),
  resolve6: vi.fn(),
}));

import { resolve4, resolve6 } from "node:dns/promises";
import { Hono } from "hono";
import { paymentMiddleware, x402ResourceServer, type SchemeNetworkServer } from "@x402/hono";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { totalScanRoutes } from "../src/server/routes/total-scan-api";
import { buildTotalScanRouteConfig } from "../src/server/wiring/scan-packs-x402";
import { resetConfigCache } from "../src/config/env";

const mockResolve4 = vi.mocked(resolve4);
const mockResolve6 = vi.mocked(resolve6);

function mockResponse(status: number, body: string, headers: Record<string, string> = {}) {
  return new Response(body, { status, headers });
}

const originalEnv = { ...process.env };
let app: Hono;

function buildApp(pricingEnabled: boolean) {
  process.env.SCAN_PACKS_ENABLED = "true";
  if (pricingEnabled) process.env.SCAN_PACK_PRICING_ENABLED = "true";
  else delete process.env.SCAN_PACK_PRICING_ENABLED;
  resetConfigCache();

  const a = new Hono();
  if (pricingEnabled) {
    const facilitatorClient = new HTTPFacilitatorClient({ url: "https://facilitator.test" });
    const resourceServer = new x402ResourceServer(facilitatorClient).register(
      "eip155:84532",
      new ExactEvmScheme() as unknown as SchemeNetworkServer,
    );
    // SLICE-136-1: reuse the production route config builder so tests cover
    // the real resource/extensions/unpaidResponseBody wiring.
    a.use(paymentMiddleware(
      buildTotalScanRouteConfig("0x0000000000000000000000000000000000000001"),
      resourceServer,
    ));
  }
  a.route("/api", totalScanRoutes);
  return a;
}

beforeEach(() => {
  process.env = { ...originalEnv };
  vi.stubGlobal("fetch", vi.fn());
  mockResolve4.mockReset();
  mockResolve6.mockReset();
  mockResolve4.mockResolvedValue(["93.184.216.34"]);
  mockResolve6.mockRejectedValue(new Error("no AAAA"));
  vi.mocked(fetch).mockImplementation((async (input: unknown) => {
    const url = typeof input === "string" ? input : (input as Request).url;
    if (url.includes("facilitator.test/supported")) {
      return mockResponse(200, JSON.stringify({
        kinds: [{ x402Version: 2, scheme: "exact", network: "eip155:84532" }],
        extensions: [],
        signers: {},
      }), { "content-type": "application/json" });
    }
    return mockResponse(404, "nf", { "content-type": "text/plain" });
  }) as never);
});

afterEach(() => {
  process.env = { ...originalEnv };
  resetConfigCache();
  vi.unstubAllGlobals();
});

describe("POST /api/total-scan x402 pricing (SLICE-133-16)", () => {
  it("pricing on + packs → 402 with summed price", async () => {
    app = buildApp(true);
    const res = await app.request("/api/total-scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://example.com", packs: ["payments-x402"] }),
    });
    expect(res.status).toBe(402);
    const body = await res.json();
    // payments-x402 is medium → $0.50
    expect(JSON.stringify(body)).toContain("0.50");
  });

  it("pricing on + no packs → 402 with $4.50 full scan", async () => {
    app = buildApp(true);
    const res = await app.request("/api/total-scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://example.com" }),
    });
    expect(res.status).toBe(402);
    const body = await res.json();
    expect(JSON.stringify(body)).toContain("4.50");
  });

  it("pricing on + two packs → 402 with summed price", async () => {
    app = buildApp(true);
    const res = await app.request("/api/total-scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://example.com", packs: ["payments-x402", "live-verification"] }),
    });
    expect(res.status).toBe(402);
    const body = await res.json();
    // medium 0.50 + heavy 0.90 = 1.40
    expect(JSON.stringify(body)).toContain("1.40");
  });

  it("pricing off → scan runs free regardless of packs", async () => {
    app = buildApp(false);
    const res = await app.request("/api/total-scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://example.com", packs: ["payments-x402"] }),
    });
    expect(res.status).toBe(200);
  });
});

describe("SLICE-136-1: production readiness (resource url + discovery ext)", () => {
  it("402 payload resource.url is https (not http behind Fly TLS termination)", async () => {
    process.env.BASE_URL = "https://agentbadge.xyz";
    app = buildApp(true);
    const res = await app.request("/api/total-scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://example.com" }),
    });
    expect(res.status).toBe(402);
    const pr = res.headers.get("payment-required");
    expect(pr).toBeTruthy();
    const payload = JSON.parse(Buffer.from(pr!, "base64").toString());
    expect(payload.resource.url).toBe("https://agentbadge.xyz/api/total-scan");
    expect(payload.resource.url.startsWith("https://")).toBe(true);
  });

  it("402 payload declares bazaar discovery extension via declareDiscoveryExtension", async () => {
    app = buildApp(true);
    const res = await app.request("/api/total-scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://example.com" }),
    });
    expect(res.status).toBe(402);
    const pr = res.headers.get("payment-required");
    const payload = JSON.parse(Buffer.from(pr!, "base64").toString());
    // declareDiscoveryExtension emits extensions.bazaar with info+schema (D10)
    expect(payload.extensions?.bazaar).toBeDefined();
    expect(payload.extensions.bazaar.info).toBeDefined();
    expect(payload.extensions.bazaar.schema).toBeDefined();
  });
});
