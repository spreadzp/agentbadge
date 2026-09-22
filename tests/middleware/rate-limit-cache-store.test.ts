import { describe, it, expect, vi, afterEach } from "vitest";
import { InMemoryCache, type CacheProvider } from "@agentbadge/cache";
import type { Context, Next } from "hono";

import { CacheRateLimitStore } from "../../src/server/middleware/rate-limit-redis-store";
import { createRateLimiter } from "../../src/server/middleware/rate-limit";

function mockContext(
  path: string,
  method = "POST",
  headers: Record<string, string> = {},
): Context {
  const capturedHeaders: Record<string, string> = {};
  return {
    req: {
      method,
      path,
      header: (name: string) => headers[name.toLowerCase()],
    },
    header: (name: string, value: string) => {
      capturedHeaders[name] = value;
    },
    json: (body: unknown, status: number) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
    _capturedHeaders: capturedHeaders,
  } as unknown as Context & { _capturedHeaders: Record<string, string> };
}

const nextFn: Next = (async () => {}) as Next;

describe("CacheRateLimitStore (SLICE-144-3)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("hit() increments via cache.incr and returns count", async () => {
    const cache = new InMemoryCache({ sweepIntervalMs: 0 });
    const store = new CacheRateLimitStore(cache);

    const first = await store.hit("203.0.113.1", 60_000);
    const second = await store.hit("203.0.113.1", 60_000);

    expect(first.count).toBe(1);
    expect(second.count).toBe(2);
    expect(first.resetAt).toBeGreaterThan(Date.now());
    await cache.close();
  });

  it("window expires → counter resets (TTL on creation)", async () => {
    vi.useFakeTimers();
    const cache = new InMemoryCache({ sweepIntervalMs: 0 });
    const store = new CacheRateLimitStore(cache);

    await store.hit("k", 1_000);
    await store.hit("k", 1_000);
    vi.advanceTimersByTime(1_100);
    const after = await store.hit("k", 1_000);

    expect(after.count).toBe(1);
    await cache.close();
  });

  it("sync surface is a no-op (TTL handles eviction)", async () => {
    const cache = new InMemoryCache({ sweepIntervalMs: 0 });
    const store = new CacheRateLimitStore(cache);

    expect(store.get("x")).toBeUndefined();
    expect(store.size()).toBe(0);
    expect(() => {
      store.set("x", { count: 1, resetAt: 0 });
      store.delete("x");
      store.sweep(Date.now());
    }).not.toThrow();
    await cache.close();
  });

  it("cache failure → hit returns count 0, never throws", async () => {
    const broken: CacheProvider = {
      get: vi.fn().mockRejectedValue(new Error("down")),
      set: vi.fn().mockRejectedValue(new Error("down")),
      delete: vi.fn().mockRejectedValue(new Error("down")),
      invalidateTag: vi.fn().mockRejectedValue(new Error("down")),
      incr: vi.fn().mockRejectedValue(new Error("down")),
      health: vi.fn().mockResolvedValue(false),
      close: vi.fn().mockResolvedValue(undefined),
    };
    const store = new CacheRateLimitStore(broken);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const entry = await store.hit("ip", 60_000);

    expect(entry.count).toBe(0);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("middleware blocks after max via async hit path", async () => {
    const cache = new InMemoryCache({ sweepIntervalMs: 0 });
    const store = new CacheRateLimitStore(cache);
    const limiter = createRateLimiter({
      windowMs: 60_000,
      max: 2,
      routes: ["/test"],
      store,
    });
    const ctx = mockContext("/test", "POST", { "fly-client-ip": "198.51.100.7" });

    await limiter(ctx, nextFn);
    await limiter(ctx, nextFn);
    const blocked = await limiter(ctx, nextFn);

    expect(blocked).toBeDefined();
    expect((blocked as Response).status).toBe(429);
    await cache.close();
  });

  it("middleware falls back to sync path when store has no hit()", async () => {
    const syncStore = {
      get: vi.fn().mockReturnValue(undefined),
      set: vi.fn(),
      delete: vi.fn(),
      sweep: vi.fn(),
      size: vi.fn().mockReturnValue(0),
    };
    const limiter = createRateLimiter({
      windowMs: 60_000,
      max: 1,
      routes: ["/test"],
      store: syncStore,
    });
    const ctx = mockContext("/test", "POST", { "fly-client-ip": "198.51.100.9" });

    await limiter(ctx, nextFn);

    expect(syncStore.get).toHaveBeenCalled();
    expect(syncStore.set).toHaveBeenCalled();
  });
});
