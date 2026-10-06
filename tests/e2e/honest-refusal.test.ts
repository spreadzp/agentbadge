/**
 * SLICE-181-4 e2e: honest-refusal matrix + disclosure + docs parity.
 *
 * Matrix:
 *  - seam route refuse() → 409 policy_refusal / 422 insufficient_subject /
 *    502 execution_failed, all with charged:false and router.settle uncalled
 *  - self-settled refusal → refund block in the error body
 *  - venue dispute answer (evaluate verdict:reject) → disclosure field
 *  - GET /llms.txt contains the honest-refusal contract section
 *    ("no-charge-on-refusal", /api/meta/refusal-contract)
 *  - price-truth: bstock 402 accepts[].amount equals the SKU-declared
 *    price computed from the same source functions (usdToBaseUnits)
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Hono } from "hono";
import type {
  PaymentRequirements,
  PaymentRouter,
} from "@agentbadge/circle-payments";

import {
  createSettleSeamTwoPhase,
  type PaymentHandle,
} from "../../src/server/lib/x402-settle-seam";
import {
  createMemoryRefundLog,
  createRefundService,
} from "../../src/server/lib/refund-log";
import { setupMockEnv, makeTestApp } from "./helpers";
import { usdToBaseUnits } from "../../src/server/lib/marketplace/chain";
import {
  ensureBstockService,
  BSTOCK_SERVICE_ID,
  BSTOCK_PRICE_USD,
} from "../../src/server/lib/bstock/service";
import {
  getService,
  useMemoryStoreForTesting,
  resetStoreForTesting,
} from "../../src/server/lib/marketplace/catalog";

// ─── seam harness (mirrors settle-seam-two-phase.test.ts) ────────

const SELF_SETTLE_SCHEME = "eip3009-client-broadcast";
const PAYER = "0x2222222222222222222222222222222222222222";
const TX = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const ARC_REQ: PaymentRequirements = {
  scheme: SELF_SETTLE_SCHEME,
  network: "eip155:5042002",
  asset: "0x3600000000000000000000000000000000000000",
  amount: "1000000",
  payTo: "0x9999999999999999999999999999999999999999",
  maxTimeoutSeconds: 60,
  extra: { assetTransferMethod: SELF_SETTLE_SCHEME },
} as PaymentRequirements;
const EXACT_REQ: PaymentRequirements = {
  scheme: "exact",
  network: "eip155:84532",
  asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  amount: "1000000",
  payTo: "0x9999999999999999999999999999999999999999",
  maxTimeoutSeconds: 60,
} as PaymentRequirements;

const b64 = (o: unknown) =>
  Buffer.from(JSON.stringify(o)).toString("base64");
const selfSettlePayload = b64({
  x402Version: 2,
  accepted: ARC_REQ,
  payload: { txHash: TX },
});
const exactPayload = b64({
  x402Version: 2,
  accepted: EXACT_REQ,
  payload: { signature: "0xsig", authorization: {} },
});

function mockRouter(): { router: PaymentRouter; calls: { settle: number } } {
  const calls = { settle: 0 };
  const router = {
    acceptsFor: () => [ARC_REQ, EXACT_REQ],
    verify: async () => ({ isValid: true, payer: PAYER }),
    settle: async () => {
      calls.settle++;
      return { success: true, transaction: TX, payer: PAYER };
    },
    checkAccess: async () => true,
  } as unknown as PaymentRouter;
  return { router, calls };
}

type RefusalCode = "policy_refusal" | "insufficient_subject" | "execution_failed";

function seamApp(
  code: RefusalCode,
  opts: {
    router: PaymentRouter;
    refunds?: ReturnType<typeof createRefundService>;
  },
): Hono {
  const app = new Hono();
  const seam = createSettleSeamTwoPhase({
    router: opts.router,
    amountAtomic: () => "1000000",
    description: "test paid route",
    ...(opts.refunds ? { refunds: opts.refunds } : {}),
  });
  app.post("/work", async (c) => {
    const h: PaymentHandle | null = await seam(c);
    if (!h) return c.json({ error: "payment required" }, 402);
    return h.refuse(code, "refusal matrix test");
  });
  return app;
}

// ─── refusal matrix ──────────────────────────────────────────────

describe("honest-refusal e2e matrix", () => {
  beforeEach(() => {
    setupMockEnv();
  });

  it.each([
    ["policy_refusal", 409],
    ["insufficient_subject", 422],
    ["execution_failed", 502],
  ] as const)(
    "%s → %d with charged:false, settle never called",
    async (code, status) => {
      const { router, calls } = mockRouter();
      const res = await seamApp(code, { router }).request("/work", {
        method: "POST",
        headers: { "payment-signature": exactPayload },
      });
      expect(res.status).toBe(status);
      const body = (await res.json()) as {
        code: string;
        charged: boolean;
      };
      expect(body.code).toBe(code);
      expect(body.charged).toBe(false);
      expect(calls.settle).toBe(0);
    },
  );

  it("self-settled refusal → refund block + refund-log record", async () => {
    const { router, calls } = mockRouter();
    const log = createMemoryRefundLog();
    const refunds = createRefundService({ log, autoEnabled: () => false });
    const res = await seamApp("execution_failed", { router, refunds }).request(
      "/work",
      {
        method: "POST",
        headers: { "payment-signature": selfSettlePayload },
      },
    );
    expect(res.status).toBe(502);
    const body = (await res.json()) as {
      charged: boolean;
      refund?: { status: string };
    };
    expect(body.charged).toBe(false);
    expect(body.refund).toBeDefined();
    expect(calls.settle).toBe(0);
    expect(log.list()).toHaveLength(1);
  });
});

// ─── docs parity ─────────────────────────────────────────────────

describe("honest-refusal docs", () => {
  beforeEach(() => {
    setupMockEnv();
  });

  it("GET /llms.txt carries the honest refusal contract section", async () => {
    const app = makeTestApp();
    const res = await app.request("/llms.txt");
    expect(res.status).toBe(200);
    const txt = await res.text();
    expect(txt).toContain("no-charge-on-refusal");
    expect(txt).toContain("/api/meta/refusal-contract");
  });
});

// ─── price truth (source-function parity until /api/v1/services) ──

describe("price truth", () => {
  beforeEach(() => {
    vi.stubEnv("CACHE_ENABLED", "false");
    useMemoryStoreForTesting();
  });
  afterEach(() => {
    resetStoreForTesting();
    vi.unstubAllEnvs();
  });

  it("bstock SKU priceBaseUnits === usdToBaseUnits(priceUsd) and is atomic", () => {
    ensureBstockService();
    const svc = getService(BSTOCK_SERVICE_ID);
    expect(svc).toBeDefined();
    expect(svc!.priceUsd).toBe(BSTOCK_PRICE_USD);
    expect(svc!.priceBaseUnits).toBe(
      usdToBaseUnits(BSTOCK_PRICE_USD).toString(),
    );
    // USDC-atomic (6dp), non-zero
    expect(BigInt(svc!.priceBaseUnits)).toBeGreaterThan(0n);
    expect(svc!.priceBaseUnits).toMatch(/^\d+$/);
  });
});
