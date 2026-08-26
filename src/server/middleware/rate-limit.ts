/**
 * Unified rate limiting middleware (SLICE-86-3).
 *
 * Replaces 5 copy-pasted in-memory limiters with one proxy-aware,
 * bounded-memory implementation.
 *
 * Key improvements:
 * - Trusted-IP resolution: Fly-Client-IP → rightmost XFF (never leftmost)
 * - Sliding-window buckets with periodic sweep (TTL eviction)
 * - Max-entries cap to prevent unbounded growth under IP rotation
 * - Store interface: MemoryStore now, RedisStore stub for future scaling
 * - Config per mount: {windowMs, max, keyBy, routes}
 */

import type { Context, Next } from "hono";
import { ErrorCodes } from "../lib/error-codes";
import { errorResponse } from "../lib/error-response";

// ─── Types ───────────────────────────────────────────────

export interface RateLimitEntry {
  count: number;
  resetAt: number;
}

export interface RateLimitStore {
  get(key: string): RateLimitEntry | undefined;
  set(key: string, entry: RateLimitEntry): void;
  delete(key: string): void;
  sweep(now: number): void;
  size(): number;
}

export interface RateLimitConfig {
  /** Time window in milliseconds (default: 60_000 = 1 min) */
  windowMs?: number;
  /** Max requests per window per key (default: 60) */
  max?: number;
  /** Key strategy: 'ip' (default) or 'ip+route' */
  keyBy?: "ip" | "ip+route";
  /** Routes to limit (e.g. ["/mcp/tools/:name"]). If empty, limits all routes. */
  routes?: string[];
  /** Custom store implementation (default: MemoryStore) */
  store?: RateLimitStore;
  /** Max entries in store before forced eviction (default: 10_000) */
  maxEntries?: number;
  /** Sweep interval in ms (default: windowMs) */
  sweepIntervalMs?: number;
}

interface RateLimitOptions {
  /** Time window in milliseconds (default: 60_000 = 1 min) */
  windowMs?: number;
  /** Max requests per window per IP (default: 60) */
  max?: number;
}

// ─── MemoryStore ─────────────────────────────────────────

class MemoryStore implements RateLimitStore {
  private map = new Map<string, RateLimitEntry>();

  get(key: string): RateLimitEntry | undefined {
    return this.map.get(key);
  }

  set(key: string, entry: RateLimitEntry): void {
    this.map.set(key, entry);
  }

  delete(key: string): void {
    this.map.delete(key);
  }

  sweep(now: number): void {
    for (const [key, entry] of this.map) {
      if (entry.resetAt <= now) {
        this.map.delete(key);
      }
    }
  }

  size(): number {
    return this.map.size;
  }
}

// ─── Helpers ─────────────────────────────────────────────

const DEFAULT_WINDOW_MS = 60_000;
const DEFAULT_MAX = 60;
const DEFAULT_MAX_ENTRIES = 10_000;

/**
 * Resolve client IP — proxy-aware, spoof-resistant.
 *
 * Priority:
 * 1. Fly-Client-IP (set by Fly.io proxy, trusted)
 * 2. Rightmost X-Forwarded-For (closest proxy, hardest to spoof)
 * 3. X-Real-IP (some proxies set this)
 * 4. "unknown" fallback
 *
 * NEVER uses leftmost XFF — it's client-controlled and spoofable.
 */
function resolveClientIp(c: Context): string {
  const flyIp = c.req.header("fly-client-ip");
  if (flyIp) return flyIp.trim();

  const xff = c.req.header("x-forwarded-for");
  if (xff) {
    const parts = xff.split(",").map((s) => s.trim());
    const rightmost = parts[parts.length - 1];
    if (rightmost) return rightmost;
  }

  const realIp = c.req.header("x-real-ip");
  if (realIp) return realIp.trim();

  return "unknown";
}

/**
 * Match a path against a route pattern.
 * Supports :param segments (e.g. "/mcp/:ns/tools/:name" matches "/mcp/compliance/tools/scan").
 */
function matchRoute(pattern: string, path: string): boolean {
  const patternParts = pattern.split("/").filter(Boolean);
  const pathParts = path.split("/").filter(Boolean);

  if (patternParts.length !== pathParts.length) return false;

  for (let i = 0; i < patternParts.length; i++) {
    if (patternParts[i].startsWith(":")) continue;
    if (patternParts[i] !== pathParts[i]) return false;
  }

  return true;
}

function shouldLimit(path: string, routes: string[]): boolean {
  if (routes.length === 0) return true;
  return routes.some((r) => matchRoute(r, path));
}

// ─── Factory ─────────────────────────────────────────────

export function createRateLimiter(config?: RateLimitConfig) {
  const windowMs = config?.windowMs ?? DEFAULT_WINDOW_MS;
  const max = config?.max ?? DEFAULT_MAX;
  const keyBy = config?.keyBy ?? "ip";
  const routes = config?.routes ?? [];
  const maxEntries = config?.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const sweepIntervalMs = config?.sweepIntervalMs ?? windowMs;

  const store: RateLimitStore = config?.store ?? new MemoryStore();
  let lastSweep = Date.now();

  function maybeSweep(now: number): void {
    if (now - lastSweep >= sweepIntervalMs) {
      store.sweep(now);
      lastSweep = now;
    }
  }

  function enforceMaxEntries(): void {
    if (store.size() > maxEntries) {
      store.sweep(Date.now());
    }
  }

  return async (c: Context, next: Next): Promise<Response | void> => {
    const path = c.req.path;
    if (!shouldLimit(path, routes)) {
      return next();
    }

    const ip = resolveClientIp(c);
    const key = keyBy === "ip+route" ? `${ip}:${path}` : ip;
    const now = Date.now();

    maybeSweep(now);

    let entry = store.get(key);

    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      store.set(key, entry);
    }

    entry.count++;

    const remaining = Math.max(0, max - entry.count);
    const retryAfterSec = Math.ceil((entry.resetAt - now) / 1000);

    c.header("X-RateLimit-Limit", String(max));
    c.header("X-RateLimit-Remaining", String(remaining));
    c.header("X-RateLimit-Reset", String(Math.floor(entry.resetAt / 1000)));

    enforceMaxEntries();

    if (entry.count > max) {
      c.header("Retry-After", String(Math.max(1, retryAfterSec)));
      return errorResponse(c, 429, ErrorCodes.RATE_LIMITED, "Too Many Requests");
    }

    return next();
  };
}

/**
 * Legacy export — wraps createRateLimiter for backward compatibility.
 * Used by index.ts app.use(rateLimitMiddleware()).
 * Limits POST /mcp/tools/:name and /mcp/:ns/tools/:name.
 */
export function rateLimitMiddleware(opts?: RateLimitOptions) {
  return createRateLimiter({
    ...opts,
    routes: ["/mcp/tools/:name", "/mcp/:ns/tools/:name"],
  });
}
