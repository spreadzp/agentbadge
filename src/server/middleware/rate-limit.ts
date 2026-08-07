/**
 * Rate limiting middleware for MCP tool endpoints.
 *
 * SLICE-7-3: Prevents DoS on POST /mcp/tools/:name.
 * In-memory sliding window per IP address.
 *
 * Reference: docs/EPICS/7-code-review-improvements/README.md §Phase 1 SLICE-7-3
 */

import type { Context, Next } from "hono";
import { ErrorCodes } from "../lib/error-codes";
import { errorResponse } from "../lib/error-response";

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

interface RateLimitOptions {
  /** Time window in milliseconds (default: 60_000 = 1 min) */
  windowMs?: number;
  /** Max requests per window per IP (default: 60) */
  max?: number;
}

const DEFAULT_WINDOW_MS = 60_000;
const DEFAULT_MAX = 60;

/**
 * Create a rate limiting middleware for POST /mcp/tools/:name.
 *
 * Returns 429 with Retry-After header when limit exceeded.
 * Includes X-RateLimit-Limit and X-RateLimit-Remaining headers.
 */
export function rateLimitMiddleware(opts?: RateLimitOptions) {
  const windowMs = opts?.windowMs ?? DEFAULT_WINDOW_MS;
  const max = opts?.max ?? DEFAULT_MAX;

  const buckets = new Map<string, RateLimitEntry>();

  function getClientIp(c: Context): string {
    return (
      c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ||
      c.req.header("x-real-ip") ||
      "unknown"
    );
  }

  return async (c: Context, next: Next): Promise<Response | void> => {
    if (c.req.method !== "POST" || !c.req.path.startsWith("/mcp/tools/")) {
      return next();
    }

    const ip = getClientIp(c);
    const now = Date.now();

    let entry = buckets.get(ip);

    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      buckets.set(ip, entry);
    }

    entry.count++;

    const remaining = Math.max(0, max - entry.count);
    const retryAfterSec = Math.ceil((entry.resetAt - now) / 1000);

    c.header("X-RateLimit-Limit", String(max));
    c.header("X-RateLimit-Remaining", String(remaining));
    c.header("X-RateLimit-Reset", String(Math.floor(entry.resetAt / 1000)));

    if (entry.count > max) {
      c.header("Retry-After", String(Math.max(1, retryAfterSec)));
      return errorResponse(c, 429, ErrorCodes.RATE_LIMITED, "Too Many Requests");
    }

    return next();
  };
}
