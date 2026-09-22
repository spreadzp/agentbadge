import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { SnapshotCache, normalizeUrl } from "../src/agent-readiness/scanner/cache";
import { createSnapshot } from "../src/agent-readiness/scanner/snapshot";

describe("normalizeUrl", () => {
  it("lowercases scheme and host", async () => {
    expect(normalizeUrl("HTTPS://Example.COM/path")).toBe("https://example.com/path");
  });

  it("strips default ports", async () => {
    expect(normalizeUrl("https://example.com:443/path")).toBe("https://example.com/path");
    expect(normalizeUrl("http://example.com:80/path")).toBe("http://example.com/path");
  });

  it("removes trailing slash", async () => {
    expect(normalizeUrl("https://example.com/")).toBe("https://example.com/");
    expect(normalizeUrl("https://example.com/path/")).toBe("https://example.com/path");
  });
});

describe("SnapshotCache", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("returns null for uncached URL", async () => {
    const cache = new SnapshotCache();
    expect(await cache.get("https://example.com/test")).toBeNull();
  });

  it("set + get returns snapshot", async () => {
    const cache = new SnapshotCache();
    const snap = createSnapshot({ url: "https://example.com/test", status: 200, body: "hi" });
    await cache.set("https://example.com/test", snap);
    expect(await cache.get("https://example.com/test")).toBe(snap);
  });

  it("returns null after TTL expires", async () => {
    const cache = new SnapshotCache({ ttl: 1000 });
    const snap = createSnapshot({ url: "https://example.com/test", status: 200, body: "hi" });
    await cache.set("https://example.com/test", snap);
    vi.advanceTimersByTime(1001);
    expect(await cache.get("https://example.com/test")).toBeNull();
  });

  it("has() returns true for fresh, false for expired", async () => {
    const cache = new SnapshotCache({ ttl: 1000 });
    const snap = createSnapshot({ url: "https://example.com/test", status: 200, body: "hi" });
    await cache.set("https://example.com/test", snap);
    expect(await cache.has("https://example.com/test")).toBe(true);
    vi.advanceTimersByTime(1001);
    expect(await cache.has("https://example.com/test")).toBe(false);
  });

  it("invalidate(url) removes specific entry", async () => {
    const cache = new SnapshotCache();
    const snap = createSnapshot({ url: "https://example.com/a", status: 200, body: "a" });
    await cache.set("https://example.com/a", snap);
    await cache.invalidate("https://example.com/a");
    expect(await cache.get("https://example.com/a")).toBeNull();
  });

  it("invalidate() clears all", async () => {
    const cache = new SnapshotCache();
    await cache.set("https://example.com/a", createSnapshot({ url: "a", status: 200, body: "a" }));
    await cache.set("https://example.com/b", createSnapshot({ url: "b", status: 200, body: "b" }));
    await cache.invalidate();
    expect(await cache.get("https://example.com/a")).toBeNull();
    expect(await cache.get("https://example.com/b")).toBeNull();
  });

  it("stats() returns hit/miss counts", async () => {
    const cache = new SnapshotCache();
    await cache.get("https://example.com/miss");
    const snap = createSnapshot({ url: "https://example.com/hit", status: 200, body: "x" });
    await cache.set("https://example.com/hit", snap);
    await cache.get("https://example.com/hit");
    const stats = cache.stats();
    expect(stats.hits).toBe(1);
    expect(stats.misses).toBe(1);
    expect(stats.size).toBe(1);
  });

  it("LRU eviction when maxSize exceeded", async () => {
    const cache = new SnapshotCache({ maxSize: 2 });
    await cache.set("https://a.com", createSnapshot({ url: "a", status: 200, body: "a" }));
    vi.advanceTimersByTime(10);
    await cache.set("https://b.com", createSnapshot({ url: "b", status: 200, body: "b" }));
    vi.advanceTimersByTime(10);
    // Access a to make it more recent
    await cache.get("https://a.com");
    vi.advanceTimersByTime(10);
    await cache.set("https://c.com", createSnapshot({ url: "c", status: 200, body: "c" }));
    expect(await cache.get("https://b.com")).toBeNull();
    expect(await cache.get("https://a.com")).not.toBeNull();
  });
});
