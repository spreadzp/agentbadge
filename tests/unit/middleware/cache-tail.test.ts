/**
 * SLICE-145-5: cache tail — NonceStore → CacheProvider, Mirror Node key
 * cache, bstock free-tier buckets via incr, hasAccess pass cache.
 *
 * Env isolation: .env sets CACHE_ENABLED=true (Valkey) — stubbed off here so
 * every test runs against a fresh InMemoryCache (same contract, per-process).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Hono } from "hono";

vi.stubEnv("CACHE_ENABLED", "false");

import { NonceStore, defaultVerifySignature } from "../../../src/server/middleware/did-auth";
import { bstockFreemium, type BstockFreemiumConfig } from "../../../src/server/middleware/bstock-freemium";
import { getCache, resetCacheForTests } from "../../../src/server/lib/cache";
import { resetConfigCache } from "../../../src/config/env";

beforeEach(() => {
  resetConfigCache();
  resetCacheForTests();
});
afterEach(() => {
  resetConfigCache();
  resetCacheForTests();
});

// ─── NonceStore over CacheProvider ──────────────────────────────

describe("NonceStore → CacheProvider", () => {
  it("issue + consume single-use via cache (consume twice → reject)", async () => {
    const store = new NonceStore();
    const nonce = await store.issue();
    expect(await store.consume(nonce)).toBe(true);
    expect(await store.consume(nonce)).toBe(false);
  });

  it("consume rejects unknown nonce", async () => {
    const store = new NonceStore();
    expect(await store.consume("f".repeat(32))).toBe(false);
  });

  it("nonces are shared across NonceStore instances via the cache", async () => {
    // Multi-instance = multi-replica analogue: a nonce issued by one
    // instance must be consumable (once) through another.
    const a = new NonceStore();
    const b = new NonceStore();
    const nonce = await a.issue();
    expect(await b.consume(nonce)).toBe(true);
    expect(await a.consume(nonce)).toBe(false);
  });

  it("fails closed when the cache backend errors (get→null / incr→0)", async () => {
    // Provider contract: implementations never throw — a backend outage
    // surfaces as get→null (miss) and incr→0. Both paths must reject.
    const cache = getCache();
    const getSpy = vi.spyOn(cache, "get").mockResolvedValueOnce(null);
    const store = new NonceStore();
    const nonce = await store.issue();
    expect(await store.consume(nonce)).toBe(false);
    getSpy.mockRestore();

    const incrSpy = vi.spyOn(cache, "incr").mockResolvedValueOnce(0);
    const nonce2 = await store.issue();
    expect(await store.consume(nonce2)).toBe(false);
    incrSpy.mockRestore();
  });
});

// ─── Mirror Node key cache ──────────────────────────────────────

describe("defaultVerifySignature mirror-key cache", () => {
  const accountId = "0.0.99999";
  const keysPayload = {
    keys: [{ _type: "ED25519", key: "aa".repeat(32) }],
  };

  afterEach(() => vi.unstubAllGlobals());

  it("second call for the same accountId does not refetch", async () => {
    const fetchSpy = vi.fn(async () =>
      new Response(JSON.stringify(keysPayload), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchSpy);

    // Both calls fail verification (bogus key) — we only care about fetch count.
    await defaultVerifySignature("challenge", "00".repeat(64), accountId);
    await defaultVerifySignature("challenge", "00".repeat(64), accountId);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("cache miss → fetch → keys stored under hedera:acct:{accountId}", async () => {
    const fetchSpy = vi.fn(async () =>
      new Response(JSON.stringify(keysPayload), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchSpy);

    await defaultVerifySignature("challenge", "00".repeat(64), accountId);
    const cached = await getCache().get(`hedera:acct:${accountId}`);
    expect(cached).toEqual(keysPayload.keys);
  });
});

// ─── bstock free-tier buckets via cache.incr ────────────────────

function makeFreemiumApp(overrides: Partial<BstockFreemiumConfig> = {}) {
  const cfg: BstockFreemiumConfig = {
    serviceId: "0x" + "11".repeat(32) as `0x${string}`,
    priceUsd: "5",
    durationSec: 30 * 86_400,
    payTo: "0x2222222222222222222222222222222222222222",
    networkId: "eip155:84532",
    usdcAddress: "0x3333333333333333333333333333333333333333",
    freePerMin: 1,
    facilitator: {
      verify: async () => ({ valid: true }),
      settle: async () => ({ success: true, transaction: "0xtx" }),
    },
    hasAccess: async () => false,
    mintPass: async () => "0xmint",
    ...overrides,
  };
  const app = new Hono<{ Variables: { agentId: string } }>();
  app.use("/x", async (c, next) => {
    c.set("agentId", "agent1");
    await next();
  });
  app.use("/x", bstockFreemium(cfg));
  app.post("/x", (c) => c.json({ ok: true }));
  return app;
}

describe("bstock free-tier via cache.incr", () => {
  it("counter is shared across middleware instances (multi-replica)", async () => {
    // Two independent bstockFreemium() instances = two replicas. With the
    // old per-instance Map each would grant its own free request; with
    // cache.incr the second request across instances must 402.
    const appA = makeFreemiumApp();
    const appB = makeFreemiumApp();
    expect((await appA.request("/x", { method: "POST" })).status).toBe(200);
    expect((await appB.request("/x", { method: "POST" })).status).toBe(402);
  });
});

// ─── hasAccess pass cache ───────────────────────────────────────

describe("hasAccess pass cache", () => {
  it("second request with same wallet skips the RPC (cached pass)", async () => {
    const hasAccess = vi.fn(async () => true);
    const app = makeFreemiumApp({ hasAccess });
    const headers = { "X-Wallet": "0xabc" };
    expect((await app.request("/x", { method: "POST", headers })).status).toBe(200);
    expect((await app.request("/x", { method: "POST", headers })).status).toBe(200);
    expect(hasAccess).toHaveBeenCalledTimes(1);
  });

  it("negative hasAccess is never cached (fresh payment not masked)", async () => {
    let allowed = false;
    const hasAccess = vi.fn(async () => allowed);
    const app = makeFreemiumApp({ hasAccess, freePerMin: 10 });
    const headers = { "X-Wallet": "0xabc" };
    await app.request("/x", { method: "POST", headers });
    allowed = true; // simulate a pass minted between requests
    const res = await app.request("/x", { method: "POST", headers });
    expect(res.status).toBe(200);
    expect(hasAccess).toHaveBeenCalledTimes(2);
  });
});
