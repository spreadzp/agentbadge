import { describe, it, expect, vi, afterEach } from "vitest";
import { InMemoryCache, type CacheProvider } from "@agentbadge/cache";

import { SnapshotCache } from "../src/agent-readiness/scanner/cache";
import { createSnapshot } from "../src/agent-readiness/scanner/snapshot";

const snap = (body: string) =>
  createSnapshot({ url: "https://example.com/robots", status: 200, body });

describe("SnapshotCache shared L2 provider (SLICE-144-5)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("writes through to provider under res:{domain}:{resource} with domain tag", async () => {
    const provider = new InMemoryCache({ sweepIntervalMs: 0 });
    const spy = vi.spyOn(provider, "set");
    const cache = new SnapshotCache({}, provider);

    await cache.set("https://example.com/robots", snap("body"), "robots");

    expect(spy).toHaveBeenCalledWith(
      "res:example.com:robots",
      expect.objectContaining({ body: "body" }),
      expect.objectContaining({
        ttlSec: 86_400, // robots → 24h
        tags: ["domain:example.com"],
      }),
    );
  });

  it("L2 hit populates L1 and skips refetch", async () => {
    const provider = new InMemoryCache({ sweepIntervalMs: 0 });
    const s = snap("shared");
    await provider.set("res:example.com:robots", s, {
      ttlSec: 86_400,
      tags: ["domain:example.com"],
    });

    // Fresh SnapshotCache (new "scan") — L1 empty, L2 hit.
    const cache = new SnapshotCache({}, provider);
    expect(await cache.get("https://example.com/robots")).toEqual(
      expect.objectContaining({ body: "shared" }),
    );
    expect(cache.stats().hits).toBe(1);
  });

  it("per-resource TTL: openapi → 6h, html-ish → 1h default", async () => {
    const provider = new InMemoryCache({ sweepIntervalMs: 0 });
    const spy = vi.spyOn(provider, "set");
    const cache = new SnapshotCache({}, provider);

    await cache.set("https://example.com/openapi", snap("o"), "openapi");
    await cache.set("https://example.com/homepage_meta", snap("h"), "homepage_meta");

    expect(spy).toHaveBeenNthCalledWith(
      1,
      "res:example.com:openapi",
      expect.anything(),
      expect.objectContaining({ ttlSec: 21_600 }),
    );
    expect(spy).toHaveBeenNthCalledWith(
      2,
      "res:example.com:homepage_meta",
      expect.anything(),
      expect.objectContaining({ ttlSec: 3_600 }),
    );
  });

  it("rescan invalidation: invalidateTag(domain:*) forces fresh fetch", async () => {
    const provider = new InMemoryCache({ sweepIntervalMs: 0 });
    const cache = new SnapshotCache({}, provider);
    await cache.set("https://example.com/robots", snap("v1"), "robots");

    await provider.invalidateTag("domain:example.com");

    // New scan instance (L1 empty) → L2 miss after tag invalidation.
    const fresh = new SnapshotCache({}, provider);
    expect(await fresh.get("https://example.com/robots")).toBeNull();
  });

  it("provider failure → L1 still works, never throws", async () => {
    const broken: CacheProvider = {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(false),
      invalidateTag: vi.fn().mockResolvedValue(0),
      incr: vi.fn().mockResolvedValue(0),
      health: vi.fn().mockResolvedValue(false),
      close: vi.fn().mockResolvedValue(undefined),
    };
    const cache = new SnapshotCache({}, broken);

    await cache.set("https://example.com/robots", snap("x"), "robots");
    // L1 hit even though L2 is dead.
    expect(await cache.get("https://example.com/robots")).toEqual(
      expect.objectContaining({ body: "x" }),
    );
  });

  it("no provider → L1-only, identical to pre-144 behavior", async () => {
    const cache = new SnapshotCache();
    await cache.set("https://example.com/robots", snap("x"), "robots");
    expect(await cache.get("https://example.com/robots")).not.toBeNull();
    // New instance → miss (no shared layer).
    const fresh = new SnapshotCache();
    expect(await fresh.get("https://example.com/robots")).toBeNull();
  });
});
