/**
 * Demand API routes.
 *
 * SLICE-46-12: POST /api/demand/request — register demand for a capability.
 * Rate limited: 10/hour/IP. Unified rate limiter.
 */

import { Hono } from "hono";
import { ErrorCodes } from "../../lib/error-codes";
import { errorResponse } from "../../lib/error-response";
import { demandStore } from "../../services/demand-registry";
import { createRateLimiter } from "../../middleware/rate-limit";

export const demandRoutes = new Hono();

// ─── Rate limiting (unified, SLICE-86-3) ─────────────────

const demandLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10,
  routes: ["/api/demand/request"],
});

export function resetDemandRateLimits(): void {
  // No-op — unified limiter handles its own store
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
  const rlResult = await demandLimiter(c, async () => { });
  if (rlResult instanceof Response) {
    return rlResult;
  }

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
