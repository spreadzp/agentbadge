/**
 * bStock MCP gate middleware (EPIC-141, SLICE-141-6).
 *
 * Three guards for the /mcp/bstock namespace route:
 * - bstockAuth: Bearer token auth against MCP_AGENT_TOKENS map
 *   (token → agentId, Q4b). 401 on missing/invalid token.
 * - bstockRateLimit: per-token sliding window, default 60 req/min → 429.
 * - bstockSseCap: max concurrent SSE connections (default 20) → 503.
 *
 * Patterns: adminAuth.ts (bearer + timing-safe compare),
 * rate-limit.ts (sliding window buckets).
 */

import { timingSafeEqual } from "node:crypto";
import type { Context, Next } from "hono";

function unauthorized(c: Context): Response {
  return c.json({ error: "Unauthorized" }, 401);
}

function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** Bearer auth against a token→agentId map. Sets c.set("agentId"). */
export function bstockAuth(tokens: ReadonlyMap<string, string>) {
  return async function bstockAuthMiddleware(
    c: Context,
    next: Next,
  ): Promise<Response | void> {
    const authHeader = c.req.header("Authorization");
    const token = authHeader?.startsWith("Bearer ")
      ? authHeader.slice(7)
      : null;
    if (!token) return unauthorized(c);

    let agentId: string | undefined;
    for (const [knownToken, id] of tokens) {
      if (safeCompare(token, knownToken)) {
        agentId = id;
        break;
      }
    }
    if (!agentId) return unauthorized(c);

    c.set("agentId", agentId);
    await next();
  };
}

interface Bucket {
  count: number;
  resetAt: number;
}

/** Per-token sliding-window rate limit → 429 over maxPerMin. */
export function bstockRateLimit(maxPerMin = 60, windowMs = 60_000) {
  const buckets = new Map<string, Bucket>();
  return async function bstockRateLimitMiddleware(
    c: Context,
    next: Next,
  ): Promise<Response | void> {
    const key = (c.get("agentId") as string | undefined) ?? "anonymous";
    const now = Date.now();
    let b = buckets.get(key);
    if (!b || now >= b.resetAt) {
      b = { count: 0, resetAt: now + windowMs };
      buckets.set(key, b);
    }
    b.count += 1;
    if (b.count > maxPerMin) {
      return c.json({ error: "Rate limit exceeded" }, 429);
    }
    await next();
  };
}

/** Bounded counter of active SSE connections. */
export class BstockSseCap {
  private activeCount = 0;
  constructor(private readonly max: number) {}

  get active(): number {
    return this.activeCount;
  }

  tryAcquire(): boolean {
    if (this.activeCount >= this.max) return false;
    this.activeCount += 1;
    return true;
  }

  release(): void {
    if (this.activeCount > 0) this.activeCount -= 1;
  }
}

/** SSE connection cap → 503 when full. Applies to GET SSE requests only. */
export function bstockSseCap(cap: BstockSseCap) {
  return async function bstockSseCapMiddleware(
    c: Context,
    next: Next,
  ): Promise<Response | void> {
    const isSse =
      c.req.method === "GET" &&
      (c.req.header("Accept") ?? "").includes("text/event-stream");
    if (!isSse) {
      await next();
      return;
    }
    if (!cap.tryAcquire()) {
      return c.json({ error: "Too many SSE connections" }, 503);
    }
    const release = () => cap.release();
    c.req.raw.signal.addEventListener("abort", release, { once: true });
    try {
      await next();
    } finally {
      // Non-aborting completions release immediately; aborted SSE
      // connections release via the abort listener.
      if (!c.req.raw.signal.aborted) release();
    }
  };
}
