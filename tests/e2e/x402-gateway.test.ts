/**
 * SLICE-223-7: x402 gateway e2e — full 402→pay→200 flow through the
 * REAL service + middleware. The only stub is the seam boundary
 * (verify/settle network call), injected via createSeam.
 */

import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import {
  decodePaymentRequiredHeader,
  decodePaymentResponseHeader,
} from "@x402/core/http";
import {
  ARC_TESTNET_CAIP2,
  ARC_TESTNET_USDC,
  InMemoryUsageRecordStore,
  createPilotRegistry,
  type PaidResource,
} from "@agentbadge/payments";
import type { PaymentRouter } from "@agentbadge/circle-payments";

import { createMemoryAgentWalletStore } from "../../src/server/lib/agent-wallet/registry.js";
import {
  createX402PaymentService,
  x402GatewayMiddleware,
  X402_PAYMENT_KEY,
  type X402PaymentRequirements,
} from "../../src/server/lib/x402-gateway/index.js";
import type {
  SettleSeamOptions,
  SettleSeamResult,
} from "../../src/server/lib/x402-settle-seam.js";

const PAYER = "0x5555555555555555555555555555555555555555";
const SEAM_RESULT: SettleSeamResult = {
  payer: PAYER,
  amountAtomic: "100000",
  tx: "0x1234abcd",
  sourceChain: ARC_TESTNET_CAIP2,
  scheme: "exact",
};

const ACCEPT: X402PaymentRequirements = {
  scheme: "exact",
  network: ARC_TESTNET_CAIP2,
  asset: ARC_TESTNET_USDC,
  amount: "100000",
  payTo: "0x742d35cc6634c0532925a3b844bc454e4438f44e",
  maxTimeoutSeconds: 60,
  extra: {},
};

interface Rig {
  app: Hono<{ Variables: { x402Payment: SettleSeamResult } }>;
  usageRecords: InMemoryUsageRecordStore;
  setSeamResult: (r: SettleSeamResult | null) => void;
  capturedSeamOpts: SettleSeamOptions[];
}

function mkRig(opts: { walletAgentId?: string } = {}): Rig {
  const usageRecords = new InMemoryUsageRecordStore();
  const capturedSeamOpts: SettleSeamOptions[] = [];
  let seamResult: SettleSeamResult | null = SEAM_RESULT;

  const walletStore = createMemoryAgentWalletStore();
  if (opts.walletAgentId) {
    void walletStore.put({
      address: PAYER,
      agentId: opts.walletAgentId,
      label: "pilot",
      kind: "eoa",
      envelope: {},
      registeredBy: PAYER,
      createdAt: 1,
      active: true,
    });
  }

  const service = createX402PaymentService({
    router: {
      acceptsFor: () => [ACCEPT],
    } as unknown as PaymentRouter,
    usageRecords,
    walletStore,
    recipient: "0x742d35cc6634c0532925a3b844bc454e4438f44e",
    createSeam: (o) => {
      capturedSeamOpts.push(o);
      return async () => seamResult;
    },
    bazaarExtensionFor: (id) => ({ bazaar: { sku: id } }),
  });

  const registry = createPilotRegistry(ARC_TESTNET_CAIP2);
  const bazaarResource: PaidResource = {
    id: "bazaar-item",
    path: "/api/v1/bazaar/item",
    method: "GET",
    priceUsd: "0.01",
    network: ARC_TESTNET_CAIP2,
    currency: "USDC",
    bazaar: true,
    description: "bazaar-listed item",
    enabled: true,
  };
  registry.register(bazaarResource);

  const app = new Hono<{
    Variables: { x402Payment: SettleSeamResult };
  }>();
  app.use(
    "/api/v1/*",
    x402GatewayMiddleware({
      service,
      registry,
      serviceAcceptsFor: () => [ACCEPT],
      bazaarExtensionFor: (id) => ({ bazaar: { sku: id } }),
    }),
  );
  app.get("/api/v1/fx/delta/premium", (c) =>
    c.json({
      ok: true,
      payment: {
        txHash: c.get(X402_PAYMENT_KEY).tx ?? null,
        amount: c.get(X402_PAYMENT_KEY).amountAtomic,
      },
    }),
  );
  app.post("/api/v1/passport/request", (c) => c.json({ ok: true }));
  app.get("/api/v1/bazaar/item", (c) => c.json({ ok: true }));
  app.get("/api/v1/free", (c) => c.json({ ok: true }));

  return {
    app,
    usageRecords,
    setSeamResult: (r) => {
      seamResult = r;
    },
    capturedSeamOpts,
  };
}

describe("x402 gateway e2e", () => {
  it("unauthenticated → 402 with decodable payment requirements", async () => {
    const { app } = mkRig();
    const res = await app.request("http://x/api/v1/fx/delta/premium");
    expect(res.status).toBe(402);
    const decoded = decodePaymentRequiredHeader(
      res.headers.get("PAYMENT-REQUIRED")!,
    );
    expect(decoded.x402Version).toBe(2);
    expect(decoded.accepts[0]!.payTo).toBe(ACCEPT.payTo);
    expect(decoded.resource.url).toContain("/api/v1/fx/delta/premium");
  });

  it("valid payment → 200 + PAYMENT-RESPONSE + UsageRecord + receipt body", async () => {
    const { app, usageRecords } = mkRig();
    const res = await app.request("http://x/api/v1/fx/delta/premium", {
      headers: { "payment-signature": "sig" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      payment: { txHash: string; amount: string };
    };
    expect(body.payment.txHash).toBe("0x1234abcd");
    expect(body.payment.amount).toBe("100000");
    const decoded = decodePaymentResponseHeader(
      res.headers.get("PAYMENT-RESPONSE")!,
    );
    expect(decoded.success).toBe(true);
    const rows = await usageRecords.listByResource("fx-delta-premium");
    expect(rows).toHaveLength(1);
    expect(rows[0].payerAddress).toBe(PAYER);
    expect(rows[0].txHash).toBe("0x1234abcd");
  });

  it("invalid payment (seam null) → 402, no UsageRecord", async () => {
    const { app, usageRecords, setSeamResult } = mkRig();
    setSeamResult(null);
    const res = await app.request("http://x/api/v1/fx/delta/premium", {
      headers: { "payment-signature": "bad" },
    });
    expect(res.status).toBe(402);
    expect(await usageRecords.listByResource("fx-delta-premium")).toHaveLength(
      0,
    );
  });

  it("bound wallet → UsageRecord.agentId; unbound → null", async () => {
    const bound = mkRig({ walletAgentId: "agent_42" });
    await bound.app.request("http://x/api/v1/fx/delta/premium", {
      headers: { "payment-signature": "sig" },
    });
    expect(
      (await bound.usageRecords.listByResource("fx-delta-premium"))[0]
        .agentId,
    ).toBe("agent_42");

    const unbound = mkRig();
    await unbound.app.request("http://x/api/v1/fx/delta/premium", {
      headers: { "payment-signature": "sig" },
    });
    expect(
      (await unbound.usageRecords.listByResource("fx-delta-premium"))[0]
        .agentId,
    ).toBeNull();
  });

  it("same requestId → single UsageRecord (dedupe anchor)", async () => {
    const { app, usageRecords } = mkRig();
    const headers = {
      "payment-signature": "sig",
      "x-request-id": "dedupe_1",
    };
    await app.request("http://x/api/v1/fx/delta/premium", { headers });
    await app.request("http://x/api/v1/fx/delta/premium", { headers });
    expect(
      await usageRecords.listByResource("fx-delta-premium"),
    ).toHaveLength(1);
  });

  it("bazaar resource → extension in the 402 header", async () => {
    const { app } = mkRig();
    const res = await app.request("http://x/api/v1/bazaar/item");
    expect(res.status).toBe(402);
    const decoded = decodePaymentRequiredHeader(
      res.headers.get("PAYMENT-REQUIRED")!,
    );
    expect(
      (decoded as unknown as { extensions?: { bazaar?: { sku?: string } } })
        .extensions?.bazaar?.sku,
    ).toBe("bazaar-item");
  });

  it("unregistered path passes through; seam unused", async () => {
    const { app, capturedSeamOpts } = mkRig();
    const res = await app.request("http://x/api/v1/free");
    expect(res.status).toBe(200);
    expect(capturedSeamOpts).toHaveLength(0);
  });

  it("seam receives resource description + extensions for bazaar", async () => {
    const { app, capturedSeamOpts } = mkRig();
    await app.request("http://x/api/v1/bazaar/item", {
      headers: { "payment-signature": "sig" },
    });
    expect(capturedSeamOpts).toHaveLength(1);
    expect(capturedSeamOpts[0].description).toBe("bazaar-listed item");
    expect(capturedSeamOpts[0].extensions).toEqual({
      bazaar: { sku: "bazaar-item" },
    });
    expect(capturedSeamOpts[0].amountAtomic()).toBe("10000");
  });
});
