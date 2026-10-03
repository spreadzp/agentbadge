/**
 * SLICE-156-1: cross-chain gateway payments — server-side tests.
 *
 * Covers: CIRCLE_GATEWAY_CHAINS env parsing, gateway probe wiring into the
 * runtime (rail degrade on verify failure), per-payTo router cache
 * (routerFor), the settle seam used by venue subscribe, and scan-packs
 * wiring onto the runtime path.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Hono } from "hono";
import { loadConfig, resetConfigCache } from "../src/config/env";
import {
  createCirclePaymentsRuntime,
} from "../src/server/lib/circle-payments";
import { createSettleSeam } from "../src/server/lib/x402-settle-seam";
import {
  wireScanPacksX402,
} from "../src/server/wiring/scan-packs-x402";
import type { CirclePaymentsConfig } from "../src/config/env";

const SELLER = "0x1111111111111111111111111111111111111111";
const AGENT = "0x2222222222222222222222222222222222222222";

// ─── env ──────────────────────────────────────────────────────────

describe("SLICE-156-1: CIRCLE_GATEWAY_CHAINS env", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    for (const v of [
      "CIRCLE_PAYMENTS_ENABLED",
      "CIRCLE_GATEWAY_ENABLED",
      "CIRCLE_ARC_ENABLED",
      "CIRCLE_IDENTITY_ENABLED",
      "CIRCLE_ESCROW_ENABLED",
      "CIRCLE_GATEWAY_API_URL",
      "CIRCLE_SELLER_ADDRESS",
      "ARC_PRIVATE_KEY",
      "CIRCLE_GATEWAY_CHAINS",
      "CIRCLE_GATEWAY_PROBE_MS",
      "CIRCLE_GATEWAY_DOWN_MS",
    ]) delete process.env[v];
    resetConfigCache();
    process.env.HEDERA_OPERATOR_ID = "0.0.1001";
    process.env.HEDERA_OPERATOR_KEY = "test-key";
    process.env.PASSPORT_TOKEN_ID = "0.0.1002";
    process.env.AUDIT_TOPIC_ID = "0.0.1003";
    process.env.DIRECTORY_TOPIC_ID = "0.0.1004";
    process.env["x402_FACILITATOR_URL"] = "https://facilitator.example.com";
    process.env["x402_FEE_PAYER"] = "0.0.1005";
    process.env["x402_TREASURY"] = "0.0.1006";
    process.env.IPFS_API_KEY = "k";
    process.env.IPFS_API_SECRET = "s";
    process.env.CIRCLE_PAYMENTS_ENABLED = "true";
    process.env.CIRCLE_GATEWAY_ENABLED = "true";
    process.env.CIRCLE_SELLER_ADDRESS = SELLER;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    resetConfigCache();
  });

  it("unset → gatewayChains undefined (default chain set)", () => {
    const cfg = loadConfig().circlePayments;
    expect(cfg?.gatewayChains).toBeUndefined();
  });

  it("CSV of CAIP-2 ids resolves to SupportedChain[]", () => {
    process.env.CIRCLE_GATEWAY_CHAINS = "eip155:84532,eip155:5042002";
    const cfg = loadConfig().circlePayments;
    expect(cfg?.gatewayChains?.map((c) => c.caip2)).toEqual([
      "eip155:84532",
      "eip155:5042002",
    ]);
  });

  it("numeric chain ids work; duplicates collapse", () => {
    process.env.CIRCLE_GATEWAY_CHAINS = "84532, 84532";
    const cfg = loadConfig().circlePayments;
    expect(cfg?.gatewayChains?.length).toBe(1);
    expect(cfg?.gatewayChains?.[0]?.caip2).toBe("eip155:84532");
  });

  it("unknown chain id → boot error (fail-fast)", () => {
    process.env.CIRCLE_GATEWAY_CHAINS = "eip155:99999999";
    expect(() => loadConfig()).toThrow(/CIRCLE_GATEWAY_CHAINS/);
  });
});

// ─── runtime: probe + routerFor ───────────────────────────────────

function baseCfg(over: Partial<CirclePaymentsConfig> = {}): CirclePaymentsConfig {
  return {
    enabled: true,
    gateway: false,
    arc: false,
    identity: false,
    escrow: false,
    gatewayApiUrl: "https://gateway-api-testnet.circle.com",
    arcRpcUrl: "https://rpc.testnet.arc.network",
    arcChainId: 5042002,
    arcMainnet: false,
    arcMainnetRpcUrl: "https://rpc.mainnet.arc.io",
    attestation: false,
    sellerAddress: SELLER,
    platformFeeBps: 0,
    ...over,
  };
}

function fakeHandle() {
  return {
    verify: vi.fn().mockResolvedValue({ isValid: true, payer: AGENT }),
    settle: vi
      .fn()
      .mockResolvedValue({ success: true, transaction: "0xtx", payer: AGENT }),
  };
}

function acceptsOf(rt: ReturnType<typeof createCirclePaymentsRuntime>) {
  return rt.router.acceptsFor("1000");
}

const hasGateway = (rt: ReturnType<typeof createCirclePaymentsRuntime>) =>
  acceptsOf(rt).some(
    (a) => (a.extra as Record<string, unknown>)?.verifyingContract,
  );

describe("SLICE-156-1: runtime probe + routerFor", () => {
  it("gatewayProbe exists only when gateway flag on", () => {
    const on = createCirclePaymentsRuntime(baseCfg({ gateway: true }), {
      handles: { exact: fakeHandle(), gateway: fakeHandle() },
    });
    expect(on.gatewayProbe).toBeDefined();
    const off = createCirclePaymentsRuntime(baseCfg({}), {
      handles: { exact: fakeHandle() },
    });
    expect(off.gatewayProbe).toBeUndefined();
  });

  it("injected gateway handle is NOT wrapped (deps.handles bypass probe)", () => {
    // deps.handles path keeps the injected handle verbatim — probe wrap
    // only applies when the runtime constructs handles itself.
    const gateway = fakeHandle();
    const rt = createCirclePaymentsRuntime(baseCfg({ gateway: true }), {
      handles: { exact: fakeHandle(), gateway },
    });
    expect(hasGateway(rt)).toBe(true);
    rt.gatewayProbe?.markFailure();
    expect(hasGateway(rt)).toBe(false);
  });

  it("probe markFailure flips accepts[] to vanilla-only until backoff", async () => {
    vi.useFakeTimers();
    try {
      const rt = createCirclePaymentsRuntime(baseCfg({ gateway: true }), {
        handles: { exact: fakeHandle(), gateway: fakeHandle() },
      });
      expect(hasGateway(rt)).toBe(true);
      rt.gatewayProbe!.markFailure();
      expect(hasGateway(rt)).toBe(false);
      vi.advanceTimersByTime(31_000);
      expect(hasGateway(rt)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("routerFor returns a distinct router per payTo, cached", () => {
    const rt = createCirclePaymentsRuntime(baseCfg({}), {
      handles: { exact: fakeHandle() },
    });
    const other = rt.routerFor(AGENT);
    expect(other).not.toBe(rt.router);
    expect(rt.routerFor(AGENT)).toBe(other);
    const entry = other.acceptsFor("1000")[0]!;
    expect(entry.payTo).toBe(AGENT);
  });
});

// ─── settle seam ──────────────────────────────────────────────────

function makeRouter(over: {
  verifyOk?: boolean;
  settleOk?: boolean;
  payer?: string;
  tx?: string;
} = {}) {
  const verifyOk = over.verifyOk ?? true;
  const settleOk = over.settleOk ?? true;
  return {
    acceptsFor: vi.fn().mockReturnValue([
      {
        scheme: "exact",
        network: "eip155:84532",
        amount: "1000",
        asset: "0xUsdc",
        payTo: SELLER,
        maxTimeoutSeconds: 300,
        extra: {},
      },
    ]),
    verify: vi.fn().mockResolvedValue(
      verifyOk
        ? { isValid: true, payer: over.payer ?? AGENT }
        : { isValid: false, invalidReason: "bad sig" },
    ),
    settle: vi.fn().mockResolvedValue(
      settleOk
        ? { success: true, transaction: over.tx ?? "0xtx", payer: over.payer ?? AGENT }
        : { success: false, errorReason: "rejected" },
    ),
  };
}

function b64(o: unknown) {
  return Buffer.from(JSON.stringify(o)).toString("base64");
}

describe("SLICE-156-1: createSettleSeam", () => {
  it("no payment-signature → null + PAYMENT-REQUIRED header with accepts", async () => {
    const router = makeRouter();
    const seam = createSettleSeam({ router: router as never, amountAtomic: () => "1000" });
    const app = new Hono();
    app.post("/x", async (c) => {
      const r = await seam(c);
      if (!r) return c.json({ error: "payment required" }, 402);
      return c.json({ payer: r.payer });
    });
    const res = await app.request("/x", { method: "POST" });
    expect(res.status).toBe(402);
    const hdr = res.headers.get("PAYMENT-REQUIRED");
    expect(hdr).toBeTruthy();
    const body = JSON.parse(Buffer.from(hdr!, "base64").toString());
    expect(body.accepts[0].payTo).toBe(SELLER);
    expect(router.verify).not.toHaveBeenCalled();
  });

  it("valid signature → verify+settle → {payer, amountAtomic, tx}", async () => {
    const router = makeRouter({ payer: AGENT, tx: "0xsettle" });
    const seam = createSettleSeam({ router: router as never, amountAtomic: () => "1000" });
    const app = new Hono();
    app.post("/x", async (c) => {
      const r = await seam(c);
      if (!r) return c.json({ error: "payment required" }, 402);
      return c.json(r);
    });
    const res = await app.request("/x", {
      method: "POST",
      headers: {
        "payment-signature": b64({
          x402Version: 2,
          accepted: {
            scheme: "exact",
            network: "eip155:84532",
            asset: "0xUsdc",
          },
          payload: {},
        }),
      },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      payer: AGENT,
      amountAtomic: "1000",
      tx: "0xsettle",
    });
    expect(router.verify).toHaveBeenCalledOnce();
    expect(router.settle).toHaveBeenCalledOnce();
  });

  it("settle rejected → null + 402 header (payment did not move)", async () => {
    const router = makeRouter({ settleOk: false });
    const seam = createSettleSeam({ router: router as never, amountAtomic: () => "1000" });
    const app = new Hono();
    app.post("/x", async (c) => {
      const r = await seam(c);
      if (!r) return c.json({ error: "payment required" }, 402);
      return c.json(r);
    });
    const res = await app.request("/x", {
      method: "POST",
      headers: {
        "payment-signature": b64({
          x402Version: 2,
          accepted: { scheme: "exact", network: "eip155:84532", asset: "0xUsdc" },
          payload: {},
        }),
      },
    });
    expect(res.status).toBe(402);
    const body = JSON.parse(
      Buffer.from(res.headers.get("PAYMENT-REQUIRED")!, "base64").toString(),
    );
    expect(body.error).toBe("rejected");
  });
});

// ─── scan-packs wiring ────────────────────────────────────────────

describe("SLICE-156-1: wireScanPacksX402 runtime path", () => {
  const originalEnv = { ...process.env };
  beforeEach(() => {
    process.env = { ...originalEnv, SCAN_PACKS_ENABLED: "true", SCAN_PACKS_PRICING_ENABLED: "true" };
    resetConfigCache();
  });
  afterEach(() => {
    process.env = { ...originalEnv };
    resetConfigCache();
  });

  it("delegates to runtime.paymentForPrice with scan-gate opts", () => {
    const spy = vi.fn().mockReturnValue((_c: unknown, next: () => Promise<void>) => next());
    const app = new Hono();
    wireScanPacksX402(app, {
      runtime: {
        paymentForPrice: spy,
        router: {} as never,
      } as never,
    });
    expect(spy).toHaveBeenCalledOnce();
    const [price, opts] = spy.mock.calls[0]!;
    expect(typeof price).toBe("function"); // dynamic pack resolver
    expect(opts).toMatchObject({
      methods: ["POST"],
      description: "AgentBadge agent-readiness scan — priced per selected rule bundle",
      mimeType: "text/event-stream",
    });
    expect(typeof opts.onBeforeChallenge).toBe("function");
    expect(typeof opts.unpaidBody).toBe("function");
    expect(typeof opts.onSettleResult).toBe("function");
    expect(typeof opts.resourceUrl).toBe("function");
  });

  it("no runtime → legacy path kept (no throw)", () => {
    const app = new Hono();
    // Legacy path constructs facilitator/schemes — in test env X402_FACILITATOR_URL
    // is unset so it logs and returns; the gate must not throw.
    expect(() => wireScanPacksX402(app)).not.toThrow();
  });
});
