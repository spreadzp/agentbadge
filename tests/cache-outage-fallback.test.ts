/**
 * Cache outage behaviour. CacheProvider.incr returns 0 on backend failure
 * (INCR never returns 0 on success), so 0 == "backend unavailable".
 * Rate limit and tx-hash replay must fall back to a per-process counter
 * instead of failing open (rate limit) or rejecting every payment (replay).
 */
import { describe, it, expect } from "vitest";
import { InMemoryCache, type CacheProvider } from "@agentbadge/cache";

import { CacheRateLimitStore } from "../src/server/middleware/rate-limit-redis-store";
import { CacheTxHashStore } from "../src/server/lib/bstock/tx-hash-store";

const downCache = (): CacheProvider =>
  Object.assign(new InMemoryCache(), { incr: async () => 0 }) as CacheProvider;

describe("CacheRateLimitStore during cache outage", () => {
  it("counts locally instead of returning count 0 (no fail-open)", async () => {
    const store = new CacheRateLimitStore(downCache());
    const a = await store.hit("203.0.113.9", 60_000);
    const b = await store.hit("203.0.113.9", 60_000);
    const c = await store.hit("203.0.113.9", 60_000);
    expect(a.count).toBe(1);
    expect(b.count).toBe(2);
    expect(c.count).toBe(3);
  });
});

describe("CacheTxHashStore during cache outage", () => {
  it("first claim succeeds, replay is still rejected (per-process)", async () => {
    const store = new CacheTxHashStore(downCache());
    const hash = "0xABCDEF";
    expect(await store.claim(hash)).toBe(true);
    expect(await store.claim(hash)).toBe(false);
    expect(await store.claim("0x123")).toBe(true);
  });
});
