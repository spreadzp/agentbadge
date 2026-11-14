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
    Variables: { x402Payment: SettleSeamResult };
  }>();
  app.use(
    "*",
    x402GatewayMiddleware({ service, registry }),
  );
  app.post("/api/v1/passport/request", (c) =>
    c.json({ payer: c.get(X402_PAYMENT_KEY).payer }),
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
});
