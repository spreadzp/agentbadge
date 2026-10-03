import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
vi.mock("node:dns/promises", () => ({
  resolve4: vi.fn(),
  resolve6: vi.fn(),
}));

import { resolve4, resolve6 } from "node:dns/promises";
import { Hono } from "hono";
import { createPaymentRouter, requirePayment } from "@agentbadge/circle-payments";
import { totalScanRoutes } from "../src/server/routes/total-scan-api";
import {
  buildTotalScanPaymentOpts,
  wireScanPacksX402,
} from "../src/server/wiring/scan-packs-x402";
import type { CirclePaymentsRuntime, PaymentForOpts } from "../src/server/lib/circle-payments";
import { resetConfigCache } from "../src/config/env";

const mockResolve4 = vi.mocked(resolve4);
const mockResolve6 = vi.mocked(resolve6);
const PAYTO = "0x0000000000000000000000000000000000000001";

const originalEnv = { ...process.env };
let app: Hono;

/** Test runtime — mimics createCirclePaymentsRuntime().paymentForPrice
 *  passthrough using the real requirePayment + shared router. */
function fakeRuntime(): CirclePaymentsRuntime {
  const handles = {
    exact: { verify: vi.fn(), settle: vi.fn() },
  };
  const router = createPaymentRouter({
    sellerAddress: PAYTO,
    gateway: false,
    arc: false,
    handles: handles as never,
  });
  return {
    router,
    paymentForPrice: (price: never, opts?: PaymentForOpts) =>
      requirePayment(price, {
        sellerAddress: opts?.payTo ?? PAYTO,
        gateway: false,
        arc: false,
        handles: handles as never,
        router,
        ...opts,
      }),
  } as never;
}

function buildApp(pricingEnabled: boolean) {
  process.env.SCAN_PACKS_ENABLED = "true";
  process.env.X402_PAY_TO = PAYTO;
  if (pricingEnabled) process.env.SCAN_PACK_PRICING_ENABLED = "true";
  else delete process.env.SCAN_PACK_PRICING_ENABLED;
  resetConfigCache();

  const a = new Hono();
  wireScanPacksX402(a, { runtime: fakeRuntime() });
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
});

afterEach(() => {
  process.env = { ...originalEnv };
  resetConfigCache();
  vi.unstubAllGlobals();
});

const post = (body: Record<string, unknown>) =>
  app.request("/api/total-scan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

describe("POST /api/total-scan x402 pricing (SLICE-133-16)", () => {
  it("pricing on + packs → 402 with summed price", async () => {
    app = buildApp(true);
    const res = await post({ url: "https://example.com", packs: ["payments-x402"] });
    expect(res.status).toBe(402);
    const body = await res.json();
    // payments-x402 is medium → $0.50
    expect(JSON.stringify(body)).toContain("0.50");
  });

  it("pricing on + no packs → 402 with $4.50 full scan", async () => {
    app = buildApp(true);
    const res = await post({ url: "https://example.com" });
    expect(res.status).toBe(402);
    const body = await res.json();
    expect(JSON.stringify(body)).toContain("4.50");
  });

  it("pricing on + two packs → 402 with summed price", async () => {
    app = buildApp(true);
    const res = await post({
      url: "https://example.com",
      packs: ["payments-x402", "live-verification"],
    });
    expect(res.status).toBe(402);
    const body = await res.json();
    // medium 0.50 + heavy 0.90 = 1.40
    expect(JSON.stringify(body)).toContain("1.40");
  });

  it("pricing off → scan runs free regardless of packs", async () => {
    app = buildApp(false);
    const res = await post({ url: "https://example.com", packs: ["payments-x402"] });
    expect(res.status).toBe(200);
  });
});

describe("SLICE-136-1: production readiness (resource url + discovery ext)", () => {
  it("402 payload resource.url is https (not http behind Fly TLS termination)", async () => {
    process.env.BASE_URL = "https://agentbadge.xyz";
    app = buildApp(true);
    const res = await post({ url: "https://example.com" });
    expect(res.status).toBe(402);
    const pr = res.headers.get("payment-required");
    expect(pr).toBeTruthy();
    const payload = JSON.parse(Buffer.from(pr!, "base64").toString());
    expect(payload.resource.url).toBe("https://agentbadge.xyz/api/total-scan");
    expect(payload.resource.url.startsWith("https://")).toBe(true);
  });

  it("402 payload declares bazaar discovery extension via declareDiscoveryExtension", async () => {
    app = buildApp(true);
    const res = await post({ url: "https://example.com" });
    expect(res.status).toBe(402);
    const pr = res.headers.get("payment-required");
    const payload = JSON.parse(Buffer.from(pr!, "base64").toString());
    // declareDiscoveryExtension emits extensions.bazaar with info+schema (D10)
    expect(payload.extensions?.bazaar).toBeDefined();
    expect(payload.extensions.bazaar.info).toBeDefined();
    expect(payload.extensions.bazaar.schema).toBeDefined();
  });
});

describe("SLICE-157-2: runtime-only wiring (1A)", () => {
  it("no runtime → route left unprotected, no throw", () => {
    process.env.SCAN_PACKS_ENABLED = "true";
    process.env.SCAN_PACK_PRICING_ENABLED = "true";
    resetConfigCache();
    const a = new Hono();
    expect(() => wireScanPacksX402(a)).not.toThrow();
  });

  it("exported opts-builder carries the full payment contract", () => {
    const opts = buildTotalScanPaymentOpts(PAYTO);
    expect(opts).toMatchObject({
      payTo: PAYTO,
      methods: ["POST"],
      description: "AgentBadge agent-readiness scan — priced per selected rule bundle",
      mimeType: "text/event-stream",
      // 157-1: legacy accepts advertised extra.paymentFlow=upfront
      extraRequirements: { paymentFlow: "upfront" },
    });
    expect(typeof opts.resourceUrl).toBe("function");
    expect(typeof opts.unpaidBody).toBe("function");
    expect(typeof opts.onBeforeChallenge).toBe("function");
    expect(typeof opts.onSettleResult).toBe("function");
    const ext = opts.extensions as Record<string, unknown> | undefined;
    expect(ext?.bazaar).toBeDefined();
  });
});
