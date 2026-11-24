/**
 * Demand API routes.
 *
 * SLICE-46-12 contract (FROZEN): POST /api/demand/request —
 * {capability_query ≤200, context? ≤1000} → 202 {demand_id, count,
 * priority, status}; 10/hour/IP unified rate limiter.
 *
 * SLICE-231-3 (D-231-7): the handler is a thin adapter over the
 * demand pipeline — source=DEMAND_API, declaredLevel=INTENT. The
 * in-memory demandStore is gone; `demand_id` is now the canonical
 * DemandSignal.id and `count`/`priority` derive from the cluster's
 * canonical-only demand (burst dups fold into their canonical).
 */

import { Hono } from "hono";
import { idempotencyKeySchema } from "../../lib/contract-guards";
import { ErrorCodes } from "../../lib/error-codes";
import { errorResponse } from "../../lib/error-response";
import { resolveActor } from "../../lib/agent-interaction/actor";
import { getDatabase } from "../../lib/database";
import { pickDemandStore } from "../../lib/demand/db-stores";
import { ingestDemand } from "../../lib/demand/pipeline";
import {
  createRateLimiter,
  MemoryStore,
  resolveClientIp,
} from "../../middleware/rate-limit";

export const demandRoutes = new Hono();

// ─── Rate limiting (unified, SLICE-86-3) ─────────────────

// Own the store so tests can reset the bucket (sweep with a far-future
// "now" deletes every entry whose resetAt <= now — i.e. all of them).
const demandStore_ = new MemoryStore();
const demandLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10,
  routes: ["/api/demand/request"],
  store: demandStore_,
});

export function resetDemandRateLimits(): void {
  demandStore_.sweep(Number.MAX_SAFE_INTEGER);
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

// ─── Response mapping (frozen contract fields) ───────────

// Legacy priority ladder — thresholds unchanged (backlog <5,
// candidate 5–19, priority ≥20 registrations).
function legacyPriority(count: number): "backlog" | "candidate" | "priority" {
  if (count >= 20) return "priority";
  if (count >= 5) return "candidate";
  return "backlog";
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

  // Idempotency-Key stays OPTIONAL (frozen contract) — when sent it
  // is validated and threaded into the store's replay probe.
  let idempotencyKey: string | null = null;
  const rawKey = c.req.header("idempotency-key");
  if (rawKey !== undefined) {
    const parsed = idempotencyKeySchema.safeParse(rawKey);
    if (!parsed.success) {
      return errorResponse(
        c,
        400,
        ErrorCodes.INVALID_INPUT,
        "idempotency-key header is malformed",
      );
    }
    idempotencyKey = parsed.data;
  }

  // ANON callers have no identity ref — bucket them by the same
  // truncated IP the limiter uses so unidentified callers never
  // merge into one unattributed actor (decisions.md: ANON-bucket).
  const actor = resolveActor(c);
  const demandActor = {
    resolution: actor.resolution,
    actorRef: actor.actorRef ?? `anon:ip:${resolveClientIp(c)}`,
  };

  const store = pickDemandStore(getDatabase());
  let res;
  try {
    res = await ingestDemand(
      store,
      {
        text: capability_query!,
        context,
        declaredLevel: "INTENT",
        source: "DEMAND_API",
      },
      demandActor,
      { idempotencyKey },
    );
  } catch {
    return errorResponse(
      c,
      500,
      ErrorCodes.INTERNAL_ERROR,
      "Demand store unavailable",
    );
  }
  if (!res.ok) {
    return errorResponse(c, 400, ErrorCodes.INVALID_INPUT, res.error);
  }

  // count = registrations under this need — canonical relatedCounts
  // (burst dups fold into their canonical, §13.2). Bounded at 1000
  // canonical rows — far past any real demand volume on this route.
  const canonicals = await store.listSignals({
    clusterId: res.cluster.id,
    canonicalOnly: true,
    limit: 1000,
  });
  const count = canonicals.reduce((n, s) => n + s.relatedCount, 0);

  return c.json(
    {
      // The canonical signal is the demand record callers reference —
      // repeat requests inside the burst window return the same id.
      demand_id: res.canonicalOf ?? res.signal.id,
      capability_query,
      count,
      priority: legacyPriority(count),
      status: "accepted",
    },
    202,
  );
});
