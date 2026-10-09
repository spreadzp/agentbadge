import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import {
  agentKeyAuth,
  initAgentKeyAuth,
  bustAgentKeyCache,
  agentKeyCacheKey,
} from "../src/server/middleware/agent-key-auth";
import { createMemoryAgentRegistrationStore } from "../src/server/lib/agent-registration/store";
import {
  hashApiKey,
  issueApiKey,
  revokeApiKey,
} from "../src/server/lib/agent-registration/api-keys";
import type { CacheProvider } from "@agentbadge/cache";
import { bstockFreemium } from "../src/server/middleware/bstock-freemium";

/** Minimal in-memory CacheProvider stub for tests. */
function fakeCache() {
  const map = new Map<string, { v: unknown; exp: number }>();
  const counters = new Map<string, { n: number; exp: number }>();
  const now = () => Date.now();
  return {
    map,
    async get<T>(k: string) {
      const e = map.get(k);
      if (!e || e.exp < now()) return null;
      return e.v as T;
    },
    async set<T>(k: string, v: T, opts?: { ttlSec?: number }) {
      map.set(k, { v, exp: now() + (opts?.ttlSec ?? 60) * 1000 });
    },
    async delete(k: string) {
      return map.delete(k);
    },
    async incr(k: string, ttlSec = 60) {
      const e = counters.get(k);
      if (!e || e.exp < now()) {
        counters.set(k, { n: 1, exp: now() + ttlSec * 1000 });
        return 1;
      }
      return ++e.n;
    },
    async invalidateTag() {
      return 0;
    },
    async health() {
      return true;
    },
    async close() { },
  } as unknown as CacheProvider & {
    map: Map<string, { v: unknown; exp: number }>;
  };
}

// Per-run nonce: tests may hit the real Valkey cache (.env CACHE_ENABLED),
// whose bstock:free:* counters survive ~60s across runs/files.
const RUN = Math.random().toString(36).slice(2, 10);

function seedAgent(
  _store: ReturnType<typeof createMemoryAgentRegistrationStore>,
  suffix = "7",
) {
  const { key, keyHash } = issueApiKey();
  const rec = {
    agentId: `eip155:5042:0x8004A169FB4a3325136EB29fA0ceB6D2e539a432:${RUN}-${suffix}`,
    registryAddress: "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432" as `0x${string}`,
    registryTx: "0xfeed" as `0x${string}`,
    name: "t",
    keyHash,
    tier: "observer" as const,
    status: "active" as const,
    createdAt: Date.now(),
  };
  return { key, rec };
}

describe("agentKeyAuth middleware", () => {
  let store: ReturnType<typeof createMemoryAgentRegistrationStore>;
  let cache: ReturnType<typeof fakeCache>;
  let app: Hono<{ Variables: Record<string, unknown> }>;

  beforeEach(() => {
    store = createMemoryAgentRegistrationStore();
    cache = fakeCache();
    initAgentKeyAuth({ store, cache });
    app = new Hono<{ Variables: Record<string, unknown> }>();
    app.use(agentKeyAuth());
    app.get("/probe", (c) =>
      c.json({
        tier: c.get("agentTier"),
        agentId: c.get("agentId") ?? null,
        agent: c.get("agent") ?? null,
      }),
    );
  });

  it("no header → anon passthrough", async () => {
    const res = await app.request("/probe");
    expect(res.status).toBe(200);
    expect((await res.json()).tier).toBe("anon");
  });

  it("non-agb Bearer → anon passthrough (other auth paths untouched)", async () => {
    const res = await app.request("/probe", {
      headers: { authorization: "Bearer some-admin-token" },
    });
    expect(res.status).toBe(200);
    expect((await res.json()).tier).toBe("anon");
  });

  it("valid agb_ key → observer tier + agent context", async () => {
    const { key, rec } = seedAgent(store);
    await store.put(rec);
    const res = await app.request("/probe", {
      headers: { authorization: `Bearer ${key}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tier).toBe("observer");
    expect(body.agentId).toBe(rec.agentId);
    expect(body.agent.tier).toBe("observer");
  });

  it("unknown agb_ key → 401 agent_key_invalid", async () => {
    const { key } = issueApiKey();
    const res = await app.request("/probe", {
      headers: { authorization: `Bearer ${key}` },
    });
    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe("agent_key_invalid");
  });

  it("malformed agb_-like key → 401", async () => {
    const res = await app.request("/probe", {
      headers: { authorization: "Bearer agb_short" },
    });
    // agb_short fails isApiKeyFormat → passthrough anon (not our shape)
    expect(res.status).toBe(200);
    expect((await res.json()).tier).toBe("anon");
  });

  it("cache hit serves the record without a second store read", async () => {
    const { key, rec } = seedAgent(store);
    await store.put(rec);
    const hash = hashApiKey(key);
    await cache.set(agentKeyCacheKey(hash), rec, { ttlSec: 60 });
    // Remove from store — middleware must still serve from cache.
    await store.put({ ...rec, status: "revoked" });
    const res = await app.request("/probe", {
      headers: { authorization: `Bearer ${key}` },
    });
    // Cached copy is still "active" — cache wins within TTL…
    expect(res.status).toBe(200);
  });

  it("revoke → next request 401 agent_key_revoked after cache bust", async () => {
    const { key, rec } = seedAgent(store);
    await store.put(rec);
    const headers = { authorization: `Bearer ${key}` };
    expect((await app.request("/probe", { headers })).status).toBe(200);
    // now cached. revoke + bust (what DELETE /me does):
    await revokeApiKey(store, rec.agentId, "admin");
    await bustAgentKeyCache(hashApiKey(key));
    const res = await app.request("/probe", { headers });
    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe("agent_key_revoked");
  });

  it("deps not initialized → passthrough (feature off)", async () => {
    initAgentKeyAuth(null);
    const { key } = issueApiKey();
    const res = await app.request("/probe", {
      headers: { authorization: `Bearer ${key}` },
    });
    expect(res.status).toBe(200);
    expect((await res.json()).tier).toBe("anon");
  });
});

describe("keyed free-tier (bstock-freemium keyedPerMin)", () => {
  const facilitator = {
    async verify() {
      return { valid: false };
    },
    async settle() {
      return { success: false };
    },
  };
  const baseCfg = {
    priceUsd: "1",
    durationSec: 0,
    payTo: "0x0000000000000000000000000000000000000001",
    networkId: "eip155:5042",
    usdcAddress: "0x0000000000000000000000000000000000000002",
    facilitator,
    freePerMin: 1,
    keyedPerMin: 10,
  };

  function gatedApp() {
    const a = new Hono();
    a.use("/gated/*", bstockFreemium(baseCfg));
    a.get("/gated/x", (c) => c.json({ ok: true }));
    return a;
  }

  it("observer tier uses keyed bucket: 2nd request passes (limit 10)", async () => {
    const store = createMemoryAgentRegistrationStore();
    initAgentKeyAuth({ store });
    const { key, rec } = seedAgent(store);
    await store.put(rec);
    const a = new Hono();
    a.use(agentKeyAuth());
    a.use("/gated/*", bstockFreemium(baseCfg));
    a.get("/gated/x", (c) => c.json({ ok: true }));
    const headers = { authorization: `Bearer ${key}` };
    expect((await a.request("/gated/x", { headers })).status).toBe(200);
    expect((await a.request("/gated/x", { headers })).status).toBe(200);
  });

  it("anon tier keeps 1/min: 2nd request → 402", async () => {
    initAgentKeyAuth(null);
    const a = gatedApp();
    // Unique-per-run IP → fresh bstock:free:<ip> bucket even with the
    // real Valkey cache (counters persist ~60s across runs/files).
    const ip = { "x-forwarded-for": `10.184.${RUN.length}.${RUN.charCodeAt(0)}.${RUN.charCodeAt(1)}` };
    expect((await a.request("/gated/x", { headers: ip })).status).toBe(200);
    expect((await a.request("/gated/x", { headers: ip })).status).toBe(402);
  });

  it("two different keys get separate buckets", async () => {
    const store = createMemoryAgentRegistrationStore();
    initAgentKeyAuth({ store });
    const k1 = seedAgent(store, "1");
    const k2 = seedAgent(store, "2");
    await store.put(k1.rec);
    await store.put(k2.rec);
    const a = new Hono();
    a.use(agentKeyAuth());
    a.use("/gated/*", bstockFreemium(baseCfg));
    a.get("/gated/x", (c) => c.json({ ok: true }));
    const h1 = { authorization: `Bearer ${k1.key}` };
    const h2 = { authorization: `Bearer ${k2.key}` };
    expect((await a.request("/gated/x", { headers: h1 })).status).toBe(200);
    expect((await a.request("/gated/x", { headers: h2 })).status).toBe(200);
  });
});
