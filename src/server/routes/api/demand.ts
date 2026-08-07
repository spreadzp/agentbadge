/**
 * Demand API routes.
 *
 * SLICE-46-12: POST /api/demand/request — register demand for a capability.
 * Rate limited: 10/hour/IP. In-memory storage with aggregation.
 */

import { Hono } from "hono";
import { ErrorCodes } from "../../lib/error-codes";
import { errorResponse } from "../../lib/error-response";
import { demandStore } from "../../services/demand-registry";

export const demandRoutes = new Hono();

// ─── Rate limiting (in-memory, per IP) ───────────────────

interface RateBucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, RateBucket>();
const WINDOW_MS = 60 * 60 * 1000; // 1 hour
const MAX_REQUESTS = 10;

function checkRateLimit(ip: string): { allowed: boolean; remaining: number; retryAfter: number } {
  const now = Date.now();
  const entry = buckets.get(ip);

  if (!entry || entry.resetAt <= now) {
    buckets.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return { allowed: true, remaining: MAX_REQUESTS - 1, retryAfter: 0 };
  }

  if (entry.count >= MAX_REQUESTS) {
    return { allowed: false, remaining: 0, retryAfter: Math.ceil((entry.resetAt - now) / 1000) };
  }

  entry.count += 1;
  return { allowed: true, remaining: MAX_REQUESTS - entry.count, retryAfter: 0 };
}

export function resetDemandRateLimits(): void {
  buckets.clear();
}

// ─── Validation ──────────────────────────────────────────

const MAX_QUERY_LEN = 200;
const MAX_CONTEXT_LEN = 1000;

function validateDemandRequest(body: unknown): { capability_query?: string; context?: string; error?: string } {
  if (!body || typeof body !== "object") {
    return { error: "Request body must be a JSON object" };
  }

  const obj = body as Record<string, unknown>;
  const capability_query = obj.capability_query;

  if (!capability_query || typeof capability_query !== "string") {
    return { error: "capability_query is required and must be a string" };
  }

  if (capability_query.trim().length === 0) {
    return { error: "capability_query must not be empty" };
  }

  if (capability_query.length > MAX_QUERY_LEN) {
    return { error: `capability_query must not exceed ${MAX_QUERY_LEN} characters` };
  }

  const context = obj.context;
  if (context !== undefined) {
    if (typeof context !== "string") {
      return { error: "context must be a string" };
    }
    if (context.length > MAX_CONTEXT_LEN) {
      return { error: `context must not exceed ${MAX_CONTEXT_LEN} characters` };
    }
  }

  return { capability_query: capability_query.trim(), context: context?.trim() || undefined };
}

// ─── POST /api/demand/request ────────────────────────────

demandRoutes.post("/api/demand/request", async (c) => {
  const ip = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || c.req.header("x-real-ip") || "unknown";

  const rate = checkRateLimit(ip);
  if (!rate.allowed) {
    c.header("Retry-After", String(rate.retryAfter));
    c.header("X-RateLimit-Limit", String(MAX_REQUESTS));
    c.header("X-RateLimit-Remaining", "0");
    return errorResponse(c, 429, ErrorCodes.RATE_LIMITED, "Rate limit: 10 requests per hour per IP");
  }

  c.header("X-RateLimit-Limit", String(MAX_REQUESTS));
  c.header("X-RateLimit-Remaining", String(rate.remaining));

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return errorResponse(c, 400, ErrorCodes.INVALID_JSON, "Invalid JSON body");
  }

  const { capability_query, context, error } = validateDemandRequest(body);
  if (error) {
    return errorResponse(c, 400, ErrorCodes.INVALID_INPUT, error);
  }

  const record = demandStore.request(capability_query!, context);

  return c.json(
    {
      demand_id: record.id,
      capability_query: record.capability_query,
      count: record.count,
      priority: record.priority,
      status: "accepted",
    },
    202,
  );
});
