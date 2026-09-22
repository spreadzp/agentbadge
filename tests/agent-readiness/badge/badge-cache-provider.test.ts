import { describe, it, expect, vi, afterEach } from "vitest";
import { InMemoryCache, type CacheProvider } from "@agentbadge/cache";

import { BadgeCache, type CacheEntry } from "../../../src/agent-readiness/badge/badge-cache";

const entry = (svg = "<svg>v</svg>"): CacheEntry => ({
  svg,
  generatedAt: "2026-09-22T10:00:00.000Z",
  reportId: "01HTEST",
});

describe("BadgeCache on CacheProvider (SLICE-144-4)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("set/get/has round-trip through the provider", async () => {
    const cache = new BadgeCache(new InMemoryCache({ sweepIntervalMs: 0 }));
    await cache.set("example.com", entry());

    expect(await cache.has("example.com")).toBe(true);
    expect(await cache.get("example.com")).toEqual(entry());
    expect(await cache.get("missing")).toBeUndefined();
  });

  it("entries carry domain:{scope} tag → invalidateTag drops them", async () => {
    const provider = new InMemoryCache({ sweepIntervalMs: 0 });
    const cache = new BadgeCache(provider);
    await cache.set("example.com", entry());
    await cache.set("other.dev", entry());

    const removed = await provider.invalidateTag("domain:example.com");

    expect(removed).toBe(1);
    expect(await cache.get("example.com")).toBeUndefined();
    expect(await cache.get("other.dev")).toEqual(entry());
  });

  it("entries expire after 24h TTL", async () => {
    vi.useFakeTimers();
    const cache = new BadgeCache(new InMemoryCache({ sweepIntervalMs: 0 }));
    await cache.set("example.com", entry());

    vi.advanceTimersByTime(24 * 60 * 60 * 1000 + 1);
    expect(await cache.get("example.com")).toBeUndefined();
  });

  it("clear() drops all badge entries via shared tag", async () => {
    const provider = new InMemoryCache({ sweepIntervalMs: 0 });
    const cache = new BadgeCache(provider);
    await cache.set("a.dev", entry());
    await cache.set("b.dev", entry());

    await cache.clear();

    expect(await cache.get("a.dev")).toBeUndefined();
    expect(await cache.get("b.dev")).toBeUndefined();
  });

  it("provider failure → get undefined / set no-throw (never throws)", async () => {
    const broken: CacheProvider = {
      get: vi.fn().mockResolvedValue(null), // RedisCacheBase degrades to null
      set: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(false),
      invalidateTag: vi.fn().mockResolvedValue(0),
      incr: vi.fn().mockResolvedValue(0),
      health: vi.fn().mockResolvedValue(false),
      close: vi.fn().mockResolvedValue(undefined),
    };
    const cache = new BadgeCache(broken);

    await expect(cache.set("x", entry())).resolves.toBeUndefined();
    expect(await cache.get("x")).toBeUndefined();
    expect(await cache.has("x")).toBe(false);
    expect(await cache.invalidate("x")).toBe(false);
  });

  it("default constructor → InMemoryCache (CACHE_ENABLED=false path)", async () => {
    const cache = new BadgeCache();
    await cache.set("example.com", entry());
    expect(await cache.get("example.com")).toEqual(entry());
  });
});
