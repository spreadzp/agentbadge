import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import { wireMarketplace } from "../src/server/wiring/marketplace-x402";
import {
  configureMarketplaceForTesting,
  resetMarketplaceForTesting,
  useMemoryStoreForTesting,
  createMarketplaceMintOnPaymentSettled,
  serviceIdFor,
  subIdToBytes32,
  upsertService,
  type MarketplaceOps,
} from "../src/server/lib/marketplace";
import type {
  CirclePaymentsRuntime,
  PaymentForOpts,
} from "../src/server/lib/circle-payments";
import { resetConfigCache } from "../src/config/env";

const TREASURY = "0x3333333333333333333333333333333333333333";
const SPLITTER = "0x4444444444444444444444444444444444444444";
const BUYER = "0x00000000000000000000000000000000000000bb";
const SVC_ID = serviceIdFor(1n, subIdToBytes32("api"));

const SVC = {
  serviceId: SVC_ID,
  passportId: "1",
  owner: "0x00000000000000000000000000000000000000bb",
  subId: "api",
  name: "Acme Search API",
  description: "Acme data API",
  category: "data",
  priceUsd: "5.00",
  priceBaseUnits: "5000000",
  durationDays: 30,
  metaURI: "local://x",
  createdAt: "2026-10-03T00:00:00.000Z",
};

function fakeOps(): MarketplaceOps {
  return {
    mintPassport: vi.fn(async () => "0xmintpassport"),
    registerService: vi.fn(async () => "0xregsvc"),
    mintServicePass: vi.fn(async () => "0xmintsvc"),
    creditPayment: vi.fn(async () => "0xcredit"),
    passportOf: vi.fn(async () => 1n),
    passportValid: vi.fn(async () => true),
    passportOwner: vi.fn(async () => BUYER),
    getService: vi.fn(async () => null),
    servicePassOf: vi.fn(async () => 0n),
    passExpiresAt: vi.fn(async () => 0n),
  };
}

const originalEnv = { ...process.env };

/** Spy runtime — records (price, opts) per paymentForPrice call. The
 *  returned middleware executes onBeforeChallenge (abort semantics)
 *  then answers a stub 402. */
function spyRuntime() {
  const calls: { route: string; price: unknown; opts?: PaymentForOpts }[] = [];
  const runtime = {
    router: {} as never,
    paymentForPrice(price: unknown, opts?: PaymentForOpts) {
      const o = opts;
      return async (c: { req: { path: string } }) => {
        calls.push({ route: c.req.path, price, opts: o });
        const r = await o?.onBeforeChallenge?.(c as never);
        if (r instanceof Response) return r;
        return new Response(JSON.stringify({ stub402: true }), { status: 402 });
      };
    },
    paymentFor(_k: string, _o?: PaymentForOpts) {
      throw new Error("not used");
    },
  };
  return { runtime: runtime as unknown as CirclePaymentsRuntime, calls };
}

function buildApp(runtime: CirclePaymentsRuntime) {
  process.env.MARKETPLACE_ENABLED = "true";
  process.env.MARKETPLACE_NFT = "0x1111111111111111111111111111111111111111";
  process.env.MARKETPLACE_SPLITTER = SPLITTER;
  process.env.MARKETPLACE_TREASURY = TREASURY;
  resetConfigCache();
  const a = new Hono();
  wireMarketplace(a, { runtime });
  return a;
}

beforeEach(() => {
  process.env = { ...originalEnv };
  useMemoryStoreForTesting();
  upsertService(SVC);
});

afterEach(() => {
  process.env = { ...originalEnv };
  resetMarketplaceForTesting();
  resetConfigCache();
});

describe("SLICE-157-3: marketplace runtime wiring", () => {
  it("passport route: static price, treasury payTo, sig+meta preCheck", async () => {
    const { runtime, calls } = spyRuntime();
    const app = buildApp(runtime);
    await app.request("/api/market/passport", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    const c = calls.find((x) => x.route === "/api/market/passport");
    expect(c).toBeDefined();
    expect(c!.price).toBe("$10");
    expect(c!.opts?.payTo).toBe(TREASURY);
    expect(c!.opts?.methods).toEqual(["POST"]);
    expect(typeof c!.opts?.onBeforeChallenge).toBe("function");
  });

  it("buy route: splitter payTo + perRailPayTo arcSelfSettle→treasury", async () => {
    const { runtime, calls } = spyRuntime();
    const app = buildApp(runtime);
    await app.request(`/api/market/buy/${SVC_ID}`, { method: "POST" });
    const c = calls.find((x) => x.route === `/api/market/buy/${SVC_ID}`);
    expect(c).toBeDefined();
    expect(c!.opts?.payTo).toBe(SPLITTER);
    expect(c!.opts?.perRailPayTo).toEqual({ arcSelfSettle: TREASURY });
    expect(typeof c!.opts?.price ?? c!.price).not.toBeUndefined();
    expect(typeof c!.opts?.onBeforeChallenge).toBe("function");
    expect(typeof c!.opts?.onSettleResult).toBe("function");
  });

  it("buy price resolver resolves catalog priceUsd", async () => {
    const { runtime, calls } = spyRuntime();
    const app = buildApp(runtime);
    await app.request(`/api/market/buy/${SVC_ID}`, { method: "POST" });
    const c = calls.find((x) => x.route === `/api/market/buy/${SVC_ID}`);
    const price = c!.price;
    expect(typeof price).toBe("function");
    const fakeCtx = { req: { path: `/api/market/buy/${SVC_ID}` } };
    expect((price as (ctx: unknown) => string)(fakeCtx)).toMatch(/^\$5\.00$|^\$5$/);
  });

  it("buy: unknown serviceId → 404 before payment", async () => {
    const { runtime } = spyRuntime();
    const app = buildApp(runtime);
    const res = await app.request(
      "/api/market/buy/0x0000000000000000000000000000000000000000000000000000000000000001",
      { method: "POST" },
    );
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("unknown serviceId");
  });

  it("passport: missing wallet sig → 400 without payment challenge", async () => {
    const { runtime } = spyRuntime();
    const app = buildApp(runtime);
    const res = await app.request("/api/market/passport", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("X-Wallet");
  });

  it("no runtime → routes mount ungated (dev semantics), no throw", () => {
    process.env.MARKETPLACE_ENABLED = "true";
    process.env.MARKETPLACE_NFT = "0x1111111111111111111111111111111111111111";
    process.env.MARKETPLACE_SPLITTER = SPLITTER;
    process.env.MARKETPLACE_TREASURY = TREASURY;
    resetConfigCache();
    const a = new Hono();
    expect(() => wireMarketplace(a)).not.toThrow();
  });
});

describe("SLICE-157-3 (5A): createMarketplaceMintOnPaymentSettled rail branch", () => {
  let ops: MarketplaceOps;

  beforeEach(() => {
    ops = fakeOps();
    configureMarketplaceForTesting({ ops });
  });

  it("base settle (scheme exact) → creditPayment + mintServicePass", async () => {
    const hook = createMarketplaceMintOnPaymentSettled();
    await hook({
      c: { req: { path: `/api/market/buy/${SVC_ID}` } },
      ok: true,
      payment: {
        payer: BUYER,
        amount: "5000000",
        transaction: "0xpay",
        network: "eip155:84532",
        scheme: "exact",
      },
    });
    expect(ops.creditPayment).toHaveBeenCalledWith(SVC_ID, 5000000n);
    expect(ops.mintServicePass).toHaveBeenCalledWith(
      BUYER,
      SVC_ID,
      expect.any(Number),
      0n,
    );
  });

  it("arc settle (scheme eip3009-client-broadcast) → mint only, no credit", async () => {
    const hook = createMarketplaceMintOnPaymentSettled();
    await hook({
      c: { req: { path: `/api/market/buy/${SVC_ID}` } },
      ok: true,
      payment: {
        payer: BUYER,
        amount: "5000000",
        transaction: "0xpayarc",
        network: "eip155:5042002",
        scheme: "eip3009-client-broadcast",
      },
    });
    expect(ops.creditPayment).not.toHaveBeenCalled();
    expect(ops.mintServicePass).toHaveBeenCalledWith(
      BUYER,
      SVC_ID,
      expect.any(Number),
      0n,
    );
  });

  it("failed settle → no ops calls", async () => {
    const hook = createMarketplaceMintOnPaymentSettled();
    await hook({
      c: { req: { path: `/api/market/buy/${SVC_ID}` } },
      ok: false,
      error: "settle failed",
    });
    expect(ops.creditPayment).not.toHaveBeenCalled();
    expect(ops.mintServicePass).not.toHaveBeenCalled();
  });
});
