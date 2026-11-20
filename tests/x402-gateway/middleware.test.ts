import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { decodePaymentRequiredHeader } from "@x402/core/http";
import {
  ARC_TESTNET_CAIP2,
  InMemoryUsageRecordStore,
  createPilotRegistry,
} from "@agentbadge/payments";

import type { SettleSeamResult } from "../../src/server/lib/x402-settle-seam.js";
import { x402GatewayMiddleware } from "../../src/server/lib/x402-gateway/middleware.js";
import { X402_PAYMENT_KEY } from "../../src/server/lib/x402-gateway/protocol.js";
import type { X402PaymentService } from "../../src/server/lib/x402-gateway/service.js";

const SEAM_RESULT: SettleSeamResult = {
  payer: "0x2222222222222222222222222222222222222222",
  amountAtomic: "100000",
  tx: "0xfeedbeef",
  sourceChain: ARC_TESTNET_CAIP2,
  scheme: "exact",
};

const mkService = (
  over: Partial<X402PaymentService> = {},
): X402PaymentService => ({
  resolvePrice: async () => ({
    resourceId: "passport-request",
    priceUsd: "0.10",
    source: "registry",
    resolvedAt: new Date(),
  }),
  buildRequirements: () => ({
    amount: "100000",
    currency: "USDC",
    network: ARC_TESTNET_CAIP2,
    recipient: "0x742d35cc6634c0532925a3b844bc454e4438f44e",
    description: "d",
    resourceId: "passport-request",
  }),
  amountAtomicFor: (_r, priceUsd) =>
    priceUsd === "0.10" ? "100000" : "0",
  verifyAndSettle: async () => SEAM_RESULT,
  requestIdFor: () => "req_test",
  recordUsage: async () => null,
  resolveAgentId: async () => null,
  ...over,
});

const mkApp = (service: X402PaymentService) => {
  const registry = createPilotRegistry(ARC_TESTNET_CAIP2);
  const app = new Hono<{
    Variables: { x402Payment?: SettleSeamResult };
  }>();
  app.use(
    "*",
    x402GatewayMiddleware({ service, registry }),
  );
  app.post("/api/v1/passport/request", (c) =>
    c.json({ payer: c.get(X402_PAYMENT_KEY)?.payer ?? null }),
  );
  app.get("/free", (c) => c.json({ free: true }));
  return app;
};

describe("x402GatewayMiddleware", () => {
  it("unregistered route passes through unpaid", async () => {
    const res = await mkApp(mkService()).request("http://x/free");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ free: true });
  });

  it("paid route without signature → 402 + spec PAYMENT-REQUIRED", async () => {
    const res = await mkApp(mkService()).request(
      "http://x/api/v1/passport/request",
      { method: "POST" },
    );
    expect(res.status).toBe(402);
    const decoded = decodePaymentRequiredHeader(
      res.headers.get("PAYMENT-REQUIRED")!,
    );
    expect(decoded.resource.url).toBe(
      "http://x/api/v1/passport/request",
    );
    expect(decoded.x402Version).toBe(2);
  });

  it("signature + settle → 200, PAYMENT-RESPONSE, UsageRecord, agentId", async () => {
    const usageRecords = new InMemoryUsageRecordStore();
    const recordUsage = vi.fn(
      async () => (await usageRecords.append({
        id: "ur_1",
        paymentId: "0xfeedbeef",
        agentId: "agent_9",
        resource: "passport-request",
        requestId: "req_test",
        amount: "100000",
        currency: "USDC",
        network: ARC_TESTNET_CAIP2,
        payerAddress: SEAM_RESULT.payer,
        txHash: "0xfeedbeef",
        createdAtMs: 1,
        payload: {},
      })),
    );
    const resolveAgentId = vi.fn(async () => "agent_9");
    const app = mkApp(
      mkService({ recordUsage, resolveAgentId }),
    );
    const res = await app.request(
      "http://x/api/v1/passport/request",
      {
        method: "POST",
        headers: { "payment-signature": "sig" },
      },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("PAYMENT-RESPONSE")).toBeTruthy();
    expect(await res.json()).toEqual({ payer: SEAM_RESULT.payer });
    expect(recordUsage).toHaveBeenCalledOnce();
    expect(resolveAgentId).toHaveBeenCalledWith(SEAM_RESULT.payer);
  });

  it("seam null → 402 retry", async () => {
    const res = await mkApp(
      mkService({ verifyAndSettle: async () => null }),
    ).request("http://x/api/v1/passport/request", {
      method: "POST",
      headers: { "payment-signature": "sig" },
    });
    expect(res.status).toBe(402);
  });

  it("seam throw (facilitator flake) → 503 typed, never 402/500 (audit F-2)", async () => {
    const res = await mkApp(
      mkService({
        verifyAndSettle: async () => {
          throw new Error("facilitator HTTP unreachable");
        },
      }),
    ).request("http://x/api/v1/passport/request", {
      method: "POST",
      headers: { "payment-signature": "sig" },
    });
    // Uncertain money movement must not read as "pay again" (402).
    expect(res.status).toBe(503);
    const body = (await res.json()) as { code?: string; error?: string };
    expect(body.code).toBe("INTERNAL_ERROR");
    expect(body.error).not.toContain("facilitator HTTP unreachable");
    expect(res.headers.get("PAYMENT-REQUIRED")).toBeNull();
  });

  it("HEAD on a GET-gated resource → 402 (audit H-1)", async () => {
    // Hono serves HEAD via the GET handler; the gate must gate it too.
    const res = await mkApp(mkService()).request(
      "http://x/api/v1/fx/delta/premium",
      { method: "HEAD" },
    );
    expect(res.status).toBe(402);
  });

  it("zero-priced resource → free pass-through, never settles (M-1)", async () => {
    const service = mkService({
      resolvePrice: async () => ({
        resourceId: "passport-request",
        priceUsd: "0",
        source: "registry",
        resolvedAt: new Date(),
      }),
      amountAtomicFor: () => "0",
    });
    const spy = vi.spyOn(service, "verifyAndSettle");
    const res = await mkApp(service).request(
      "http://x/api/v1/passport/request",
      { method: "POST", headers: { "payment-signature": "sig" } },
    );
    expect(res.status).toBe(200);
    expect(spy).not.toHaveBeenCalled();
  });

  it("settled + usage write throws → still 200 + PAYMENT-RESPONSE (C-1)", async () => {
    const res = await mkApp(
      mkService({
        recordUsage: async () => {
          throw new Error("db down");
        },
      }),
    ).request("http://x/api/v1/passport/request", {
      method: "POST",
      headers: { "payment-signature": "sig" },
    });
    // Money already moved — the resource MUST still be served and the
    // receipt emitted; the lost UsageRecord is logged for reconciliation.
    expect(res.status).toBe(200);
    expect(res.headers.get("PAYMENT-RESPONSE")).toBeTruthy();
    expect(await res.json()).toEqual({ payer: SEAM_RESULT.payer });
  });
});
