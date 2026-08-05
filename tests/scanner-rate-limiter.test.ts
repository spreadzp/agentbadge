import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ScannerRateLimiter } from "../src/agent-readiness/scanner/rate-limiter";

describe("ScannerRateLimiter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows first 20 requests within 1 minute", () => {
    const limiter = new ScannerRateLimiter({ maxRequests: 20, windowMs: 60_000 });
    for (let i = 0; i < 20; i++) {
      const result = limiter.checkDomain("example.com");
      expect(result.allowed).toBe(true);
      limiter.recordRequest("example.com");
    }
  });

  it("blocks 21st request within same window", () => {
    const limiter = new ScannerRateLimiter({ maxRequests: 20, windowMs: 60_000 });
    for (let i = 0; i < 20; i++) {
      limiter.recordRequest("example.com");
    }
    const result = limiter.checkDomain("example.com");
    expect(result.allowed).toBe(false);
    expect(result.retryAfterMs).toBeGreaterThan(0);
  });

  it("allows requests after window expires", () => {
    const limiter = new ScannerRateLimiter({ maxRequests: 20, windowMs: 60_000 });
    for (let i = 0; i < 20; i++) {
      limiter.recordRequest("example.com");
    }
    vi.advanceTimersByTime(60_001);
    const result = limiter.checkDomain("example.com");
    expect(result.allowed).toBe(true);
  });

  it("rate limits domains independently", () => {
    const limiter = new ScannerRateLimiter({ maxRequests: 20, windowMs: 60_000 });
    for (let i = 0; i < 20; i++) {
      limiter.recordRequest("example.com");
    }
    const blocked = limiter.checkDomain("example.com");
    expect(blocked.allowed).toBe(false);

    const other = limiter.checkDomain("other.com");
    expect(other.allowed).toBe(true);
  });

  it("reset(domain) clears only that domain", () => {
    const limiter = new ScannerRateLimiter({ maxRequests: 20, windowMs: 60_000 });
    for (let i = 0; i < 20; i++) {
      limiter.recordRequest("example.com");
      limiter.recordRequest("other.com");
    }
    limiter.reset("example.com");
    expect(limiter.checkDomain("example.com").allowed).toBe(true);
    expect(limiter.checkDomain("other.com").allowed).toBe(false);
  });

  it("reset() clears all domains", () => {
    const limiter = new ScannerRateLimiter({ maxRequests: 20, windowMs: 60_000 });
    for (let i = 0; i < 20; i++) {
      limiter.recordRequest("example.com");
      limiter.recordRequest("other.com");
    }
    limiter.reset();
    expect(limiter.checkDomain("example.com").allowed).toBe(true);
    expect(limiter.checkDomain("other.com").allowed).toBe(true);
  });
});
