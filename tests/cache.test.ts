import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { SnapshotCache, normalizeUrl } from "../src/agent-readiness/scanner/cache";
import { createSnapshot } from "../src/agent-readiness/scanner/snapshot";

describe("normalizeUrl", () => {
  it("lowercases scheme and host", () => {
    expect(normalizeUrl("HTTPS://Example.COM/path")).toBe("https://example.com/path");
  });

  it("strips default ports", () => {
    expect(normalizeUrl("https://example.com:443/path")).toBe("https://example.com/path");
    expect(normalizeUrl("http://example.com:80/path")).toBe("http://example.com/path");
  });

  it("removes trailing slash", () => {
    expect(normalizeUrl("https://example.com/")).toBe("https://example.com/");
    expect(normalizeUrl("https://example.com/path/")).toBe("https://example.com/path");
  });
});

describe("SnapshotCache", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("returns null for uncached URL", () => {
    const cache = new SnapshotCache();
    expect(cache.get("https://example.com/test")).toBeNull();
  });

  it("set + get returns snapshot", () => {
    const cache = new SnapshotCache();
    const snap = createSnapshot({ url: "https://example.com/test", status: 200, body: "hi" });
    cache.set("https://example.com/test", snap);
    expect(cache.get("https://example.com/test")).toBe(snap);
  });

  it("returns null after TTL expires", () => {
    const cache = new SnapshotCache({ ttl: 1000 });
    const snap = createSnapshot({ url: "https://example.com/test", status: 200, body: "hi" });
    cache.set("https://example.com/test", snap);
    vi.advanceTimersByTime(1001);
    expect(cache.get("https://example.com/test")).toBeNull();
  });

  it("has() returns true for fresh, false for expired", () => {
    const cache = new SnapshotCache({ ttl: 1000 });
    const snap = createSnapshot({ url: "https://example.com/test", status: 200, body: "hi" });
    cache.set("https://example.com/test", snap);
    expect(cache.has("https://example.com/test")).toBe(true);
    vi.advanceTimersByTime(1001);
    expect(cache.has("https://example.com/test")).toBe(false);
  });

  it("invalidate(url) removes specific entry", () => {
    const cache = new SnapshotCache();
    const snap = createSnapshot({ url: "https://example.com/a", status: 200, body: "a" });
    cache.set("https://example.com/a", snap);
    cache.invalidate("https://example.com/a");
    expect(cache.get("https://example.com/a")).toBeNull();
  });

  it("invalidate() clears all", () => {
    const cache = new SnapshotCache();
    cache.set("https://example.com/a", createSnapshot({ url: "a", status: 200, body: "a" }));
    cache.set("https://example.com/b", createSnapshot({ url: "b", status: 200, body: "b" }));
    cache.invalidate();
    expect(cache.get("https://example.com/a")).toBeNull();
    expect(cache.get("https://example.com/b")).toBeNull();
  });

  it("stats() returns hit/miss counts", () => {
    const cache = new SnapshotCache();
    cache.get("https://example.com/miss");
    const snap = createSnapshot({ url: "https://example.com/hit", status: 200, body: "x" });
    cache.set("https://example.com/hit", snap);
    cache.get("https://example.com/hit");
    const stats = cache.stats();
    expect(stats.hits).toBe(1);
    expect(stats.misses).toBe(1);
    expect(stats.size).toBe(1);
  });

  it("LRU eviction when maxSize exceeded", () => {
    const cache = new SnapshotCache({ maxSize: 2 });
    cache.set("https://a.com", createSnapshot({ url: "a", status: 200, body: "a" }));
    vi.advanceTimersByTime(10);
    cache.set("https://b.com", createSnapshot({ url: "b", status: 200, body: "b" }));
    vi.advanceTimersByTime(10);
    // Access a to make it more recent
    cache.get("https://a.com");
    vi.advanceTimersByTime(10);
    cache.set("https://c.com", createSnapshot({ url: "c", status: 200, body: "c" }));
    expect(cache.get("https://b.com")).toBeNull();
    expect(cache.get("https://a.com")).not.toBeNull();
  });
});
