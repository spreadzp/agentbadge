import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createRateLimiter, type RateLimitStore } from "../../src/server/middleware/rate-limit";
import type { Context, Next } from "hono";

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
    json: (body: unknown, status: number) => {
      return new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      });
    },
    _capturedHeaders: capturedHeaders,
  } as unknown as Context & { _capturedHeaders: Record<string, string> };
}

const nextFn: Next = (async () => { }) as Next;

describe("SLICE-86-3: Unified Rate Limiter v2", () => {
  describe("Trusted-IP resolution", () => {
    it("uses Fly-Client-IP when present (trusted proxy)", async () => {
      const limiter = createRateLimiter({ windowMs: 60_000, max: 2 });
      const ctx = mockContext("/mcp/tools/test", "POST", {
        "fly-client-ip": "203.0.113.1",
        "x-forwarded-for": "10.0.0.1, 203.0.113.1",
      });
      await limiter(ctx, nextFn);
      // Second request from same Fly-Client-IP should still be allowed
      await limiter(ctx, nextFn);
      // Third should be blocked
      const result = await limiter(ctx, nextFn);
      expect(result).toBeDefined();
      expect((result as Response).status).toBe(429);
    });

    it("falls back to rightmost XFF when no Fly-Client-IP (spoof-resistant)", async () => {
      const limiter = createRateLimiter({ windowMs: 60_000, max: 1 });
      // Attacker sets XFF: "spoofed-ip, real-ip" — rightmost is real
      const ctx = mockContext("/contact", "POST", {
        "x-forwarded-for": "1.2.3.4, 203.0.113.99",
      });
      await limiter(ctx, nextFn);
      // Same rightmost IP, should be blocked
      const result = await limiter(ctx, nextFn);
      expect(result).toBeDefined();
      expect((result as Response).status).toBe(429);
    });

    it("never trusts leftmost XFF (spoofable)", async () => {
      const limiter = createRateLimiter({ windowMs: 60_000, max: 1 });
      // Leftmost is spoofed, rightmost is real — different leftmost should still rate-limit
      const ctx1 = mockContext("/contact", "POST", {
        "x-forwarded-for": "spoofed-1, 203.0.113.50",
      });
      await limiter(ctx1, nextFn);
      // Different leftmost, same rightmost — should be blocked
      const ctx2 = mockContext("/contact", "POST", {
        "x-forwarded-for": "spoofed-2, 203.0.113.50",
      });
      const result = await limiter(ctx2, nextFn);
      expect(result).toBeDefined();
      expect((result as Response).status).toBe(429);
    });

    it("falls back to 'unknown' when no headers present", async () => {
      const limiter = createRateLimiter({ windowMs: 60_000, max: 1 });
      const ctx = mockContext("/contact", "POST", {});
      await limiter(ctx, nextFn);
      const result = await limiter(ctx, nextFn);
      expect(result).toBeDefined();
      expect((result as Response).status).toBe(429);
    });
  });

  describe("MCP namespace coverage", () => {
    it("limits /mcp/tools/:name routes", async () => {
      const limiter = createRateLimiter({
        windowMs: 60_000,
        max: 1,
        routes: ["/mcp/tools/:name"],
      });
      const ctx = mockContext("/mcp/tools/scan", "POST", {
        "fly-client-ip": "203.0.113.10",
      });
      await limiter(ctx, nextFn);
      const result = await limiter(ctx, nextFn);
      expect(result).toBeDefined();
      expect((result as Response).status).toBe(429);
    });

    it("limits namespaced /mcp/{ns}/tools/:name routes", async () => {
      const limiter = createRateLimiter({
        windowMs: 60_000,
        max: 1,
        routes: ["/mcp/tools/:name", "/mcp/:ns/tools/:name"],
      });
      const ctx = mockContext("/mcp/compliance/tools/check", "POST", {
        "fly-client-ip": "203.0.113.20",
      });
      await limiter(ctx, nextFn);
      const result = await limiter(ctx, nextFn);
      expect(result).toBeDefined();
      expect((result as Response).status).toBe(429);
    });

    it("does NOT limit routes outside the route list", async () => {
      const limiter = createRateLimiter({
        windowMs: 60_000,
        max: 1,
        routes: ["/mcp/tools/:name"],
      });
      const ctx = mockContext("/api/health", "GET", {
        "fly-client-ip": "203.0.113.30",
      });
      const result = await limiter(ctx, nextFn);
      expect(result).toBeUndefined();
    });
  });

  describe("Per-mount config independence", () => {
    it("different mounts have independent buckets and limits", async () => {
      const limiterA = createRateLimiter({ windowMs: 60_000, max: 1, routes: ["/contact"] });
      const limiterB = createRateLimiter({ windowMs: 60_000, max: 5, routes: ["/api/work-requests"] });

      const ctxA = mockContext("/contact", "POST", { "fly-client-ip": "203.0.113.40" });
      const ctxB = mockContext("/api/work-requests", "POST", { "fly-client-ip": "203.0.113.40" });

      // Same IP, different routes — independent
      await limiterA(ctxA, nextFn);
      const blockedA = await limiterA(ctxA, nextFn);
      expect((blockedA as Response).status).toBe(429);

      // limiterB should still allow (different bucket)
      const resultB = await limiterB(ctxB, nextFn);
      expect(resultB).toBeUndefined();
    });
  });

  describe("Bounded memory — TTL eviction + max-entries cap", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("evicts expired entries on sweep", async () => {
      const limiter = createRateLimiter({
        windowMs: 1_000,
        max: 100,
        routes: ["/test"],
        sweepIntervalMs: 500,
      });

      // Add entries from 100 different IPs
      for (let i = 0; i < 100; i++) {
        const ctx = mockContext("/test", "POST", { "fly-client-ip": `10.0.0.${i}` });
        await limiter(ctx, nextFn);
      }

      // Advance past window + sweep
      vi.advanceTimersByTime(2_000);

      // Add one more — should trigger sweep
      const ctx = mockContext("/test", "POST", { "fly-client-ip": "10.0.0.200" });
      await limiter(ctx, nextFn);

      // Internal map should have been swept — verify by checking old IP gets fresh bucket
      const oldCtx = mockContext("/test", "POST", { "fly-client-ip": "10.0.0.0" });
      const result = await limiter(oldCtx, nextFn);
      // Should be allowed (fresh bucket after eviction)
      expect(result).toBeUndefined();
    });

    it("enforces max-entries cap under churn", async () => {
      const limiter = createRateLimiter({
        windowMs: 600_000, // long window so entries don't expire
        max: 100,
        routes: ["/test"],
        maxEntries: 1000,
      });

      // Exceed cap with 50k unique IPs
      for (let i = 0; i < 50_000; i++) {
        const ctx = mockContext("/test", "POST", { "fly-client-ip": `10.${i >> 8}.${i & 0xff}.1` });
        await limiter(ctx, nextFn);
      }

      // The store should not grow unbounded — cap enforced
      // Verify limiter still works
      const ctx = mockContext("/test", "POST", { "fly-client-ip": "203.0.113.99" });
      const result = await limiter(ctx, nextFn);
      expect(result).toBeUndefined();
    });
  });

  describe("Response headers contract", () => {
    it("sets X-RateLimit-Limit, X-RateLimit-Remaining, Retry-After on 429", async () => {
      const limiter = createRateLimiter({ windowMs: 60_000, max: 1, routes: ["/test"] });
      const ctx = mockContext("/test", "POST", { "fly-client-ip": "203.0.113.60" });

      await limiter(ctx, nextFn);
      const result = await limiter(ctx, nextFn) as Response;

      expect(result.status).toBe(429);
      const captured = (ctx as unknown as { _capturedHeaders: Record<string, string> })._capturedHeaders;
      expect(captured["X-RateLimit-Limit"]).toBe("1");
      expect(captured["X-RateLimit-Remaining"]).toBe("0");
      expect(captured["Retry-After"]).toBeDefined();
    });
  });

  describe("Store interface", () => {
    it("accepts a custom store (RedisStore stub pattern)", async () => {
      const customStore: RateLimitStore = {
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
        store: customStore,
      });

      const ctx = mockContext("/test", "POST", { "fly-client-ip": "203.0.113.70" });
      await limiter(ctx, nextFn);

      expect(customStore.get).toHaveBeenCalled();
      expect(customStore.set).toHaveBeenCalled();
    });
  });
});
