import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { decodePaymentRequiredHeader } from "@x402/core/http";
import {
  ARC_TESTNET_CAIP2,
  InMemoryUsageRecordStore,
  createPilotRegistry,
} from "@agentbadge/payments";
import type { PaymentRouter } from "@agentbadge/circle-payments";

import type { SettleSeamResult } from "../../src/server/lib/x402-settle-seam.js";
import type { X402PaymentService } from "../../src/server/lib/x402-gateway/service.js";
import {
  resetFxDeltaRuntime,
  setFxDeltaRuntime,
  type FxDeltaRuntime,
} from "../../src/server/lib/fx-delta/index.js";
import { wireX402Gateway } from "../../src/server/wiring/x402-gateway.js";

const fakeEngine = () =>
  ({
    engine: {
      getAll: () => [],
      getEvents: () => [],
      getHistory: () => [],
    },
  }) as unknown as FxDeltaRuntime;

const SEAM_RESULT: SettleSeamResult = {
  payer: "0x4444444444444444444444444444444444444444",
  amountAtomic: "20000",
  tx: "0xbeef",
  sourceChain: ARC_TESTNET_CAIP2,
  scheme: "exact",
};

const fakeRuntime = () =>
  ({
    router: { acceptsFor: () => [] } as unknown as PaymentRouter,
  }) as never;

const mkService = (
  usageRecords: InMemoryUsageRecordStore,
): X402PaymentService => ({
  resolvePrice: async () => ({
    resourceId: "fx-delta-premium",
    priceUsd: "0.02",
    source: "registry",
    resolvedAt: new Date(),
  }),
  buildRequirements: () => ({
    amount: "20000",
    currency: "USDC",
    network: ARC_TESTNET_CAIP2,
    recipient: "0x742d35cc6634c0532925a3b844bc454e4438f44e",
    description: "d",
    resourceId: "fx-delta-premium",
  }),
  amountAtomicFor: () => "20000",
  verifyAndSettle: async () => SEAM_RESULT,
  requestIdFor: () => "req_fx",
  recordUsage: async (input) =>
    usageRecords.append({
      id: `ur_${input.requestId}`,
      paymentId: input.settleResult.tx ?? input.requestId,
      agentId: input.agentId,
      resource: input.resource.id,
      requestId: input.requestId,
      amount: input.settleResult.amountAtomic,
      currency: input.resource.currency,
      network: input.resource.network,
      payerAddress: input.settleResult.payer,
      txHash: input.settleResult.tx ?? null,
      createdAtMs: 1,
      payload: input.payload ?? {},
    }),
  resolveAgentId: async () => null,
});

const wire = (service: X402PaymentService) => {
  const app = new Hono();
  wireX402Gateway(app, {
    runtime: fakeRuntime(),
    service,
    registry: createPilotRegistry(ARC_TESTNET_CAIP2),
  });
  return app;
};

describe("wireX402Gateway (pilot fx-delta-premium)", () => {
  const saved = process.env.X402_GATEWAY_ENABLED;
  beforeEach(() => {
    process.env.X402_GATEWAY_ENABLED = "true";
  });
  afterEach(() => {
    process.env.X402_GATEWAY_ENABLED = saved;
  });

  it("engine on, no signature → 402 + PAYMENT-REQUIRED on the seed path", async () => {
    setFxDeltaRuntime(fakeEngine());
    const app = wire(mkService(new InMemoryUsageRecordStore()));
    const res = await app.request("http://x/api/v1/fx/delta/premium");
    resetFxDeltaRuntime();
    expect(res.status).toBe(402);
    const decoded = decodePaymentRequiredHeader(
      res.headers.get("PAYMENT-REQUIRED")!,
    );
    expect(decoded.resource.url).toContain("/api/v1/fx/delta/premium");
  });

  it("engine off → preCheck 503 before settle — payer not charged", async () => {
    const usageRecords = new InMemoryUsageRecordStore();
    const service = mkService(usageRecords);
    const spy = vi.spyOn(service, "verifyAndSettle");
    const app = wire(service);
    const res = await app.request("http://x/api/v1/fx/delta/premium", {
      headers: { "payment-signature": "sig" },
    });
    expect(res.status).toBe(503);
    expect(spy).not.toHaveBeenCalled();
    expect(res.headers.get("PAYMENT-RESPONSE")).toBeNull();
    expect(
      await usageRecords.listByResource("fx-delta-premium"),
    ).toHaveLength(0);

    // No signature → same 503: never offer payment for a dead engine.
    const res2 = await app.request("http://x/api/v1/fx/delta/premium");
    expect(res2.status).toBe(503);
    expect(res2.headers.get("PAYMENT-REQUIRED")).toBeNull();
  });

  it("signature → 200 snapshot + payment body + PAYMENT-RESPONSE + UsageRecord", async () => {
    setFxDeltaRuntime(fakeEngine());
    try {
      const usageRecords = new InMemoryUsageRecordStore();
      const service = mkService(usageRecords);
      const spy = vi.spyOn(service, "verifyAndSettle");
      const app = wire(service);
      const res = await app.request("http://x/api/v1/fx/delta/premium", {
        headers: { "payment-signature": "sig" },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        payment: { txHash: string; amount: string };
      };
      expect(body.payment.txHash).toBe("0xbeef");
      expect(res.headers.get("PAYMENT-RESPONSE")).toBeTruthy();
      expect(spy).toHaveBeenCalledOnce();
      const rows = await usageRecords.listByResource("fx-delta-premium");
      expect(rows).toHaveLength(1);
      expect(rows[0].amount).toBe("20000");
      expect(rows[0].agentId).toBeNull();
    } finally {
      resetFxDeltaRuntime();
    }
  });

  it("GET on non-registered path passes through", async () => {
    const app = wire(mkService(new InMemoryUsageRecordStore()));
    const res = await app.request("http://x/api/v1/fx/delta/other");
    expect(res.status).toBe(404);
  });
});
