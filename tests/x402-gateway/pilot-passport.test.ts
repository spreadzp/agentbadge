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
import { wireX402Gateway } from "../../src/server/wiring/x402-gateway.js";

const SEAM_RESULT: SettleSeamResult = {
  payer: "0x3333333333333333333333333333333333333333",
  amountAtomic: "100000",
  tx: "0xcafe",
  sourceChain: ARC_TESTNET_CAIP2,
  scheme: "exact",
};

const fakeRuntime = () =>
  ({
    router: { acceptsFor: () => [] } as unknown as PaymentRouter,
  }) as never;

const mkService = (
  usageRecords: InMemoryUsageRecordStore,
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
  amountAtomicFor: () => "100000",
  verifyAndSettle: async () => SEAM_RESULT,
  requestIdFor: () => "req_pilot",
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
  resolveAgentId: async () => "agent_pilot",
  ...over,
});

describe("wireX402Gateway (pilot passport-request)", () => {
  const saved = process.env.X402_GATEWAY_ENABLED;
  beforeEach(() => {
    process.env.X402_GATEWAY_ENABLED = "true";
  });
  afterEach(() => {
    process.env.X402_GATEWAY_ENABLED = saved;
  });

  it("flag off → route not mounted (404, ungated)", async () => {
    process.env.X402_GATEWAY_ENABLED = "false";
    const app = new Hono();
    wireX402Gateway(app, { runtime: fakeRuntime() });
    const res = await app.request("http://x/api/v1/passport/request", {
      method: "POST",
    });
    expect(res.status).toBe(404);
  });

  it("flag on → 402 + spec PAYMENT-REQUIRED on the seed path", async () => {
    const app = new Hono();
    wireX402Gateway(app, {
      runtime: fakeRuntime(),
      service: mkService(new InMemoryUsageRecordStore()),
      registry: createPilotRegistry(ARC_TESTNET_CAIP2),
    });
    const res = await app.request("http://x/api/v1/passport/request", {
      method: "POST",
    });
    expect(res.status).toBe(402);
    const decoded = decodePaymentRequiredHeader(
      res.headers.get("PAYMENT-REQUIRED")!,
    );
    expect(decoded.resource.url).toContain("/api/v1/passport/request");
  });

  it("signature → settle → PAYMENT-RESPONSE + UsageRecord + agentId", async () => {
    const usageRecords = new InMemoryUsageRecordStore();
    const service = mkService(usageRecords);
    const resolveSpy = vi.spyOn(service, "resolveAgentId");
    const app = new Hono();
    wireX402Gateway(app, {
      runtime: fakeRuntime(),
      service,
      registry: createPilotRegistry(ARC_TESTNET_CAIP2),
    });
    const res = await app.request("http://x/api/v1/passport/request", {
      method: "POST",
      headers: { "payment-signature": "sig" },
    });
    // Payment passed the gate; handler = real passport route →
    // chainDisabled (passportChainEnabled off in test env) — proves
    // pass-through without needing Hedera infra.
    expect(res.status).not.toBe(402);
    expect(res.headers.get("PAYMENT-RESPONSE")).toBeTruthy();
    expect(resolveSpy).toHaveBeenCalledWith(SEAM_RESULT.payer);
    const rows = await usageRecords.listByResource("passport-request");
    expect(rows).toHaveLength(1);
    expect(rows[0].agentId).toBe("agent_pilot");
    expect(rows[0].paymentId).toBe("0xcafe");
  });

  it("other /api/v1 paths pass through ungated", async () => {
    const app = new Hono();
    app.get("/api/v1/free", (c) => c.json({ ok: true }));
    wireX402Gateway(app, {
      runtime: fakeRuntime(),
      service: mkService(new InMemoryUsageRecordStore()),
      registry: createPilotRegistry(ARC_TESTNET_CAIP2),
    });
    const res = await app.request("http://x/api/v1/free");
    expect(res.status).toBe(200);
    expect(res.headers.get("PAYMENT-REQUIRED")).toBeNull();
  });
});
