/**
 * SLICE-181-3 (MYPROJ-2526): bstock feed-health gate — D-181-4.
 *
 * Mounted BEFORE the freemium payment gate on /mcp/bstock. When the
 * feed is fully dead (tracked symbols exist but every one is stale
 * past the 15s rule) data calls are refused with 503
 * data_unavailable — a payment must never be verified/settled for
 * data the server cannot honestly serve (charge: never, O2).
 *
 * Only data calls (POST) are gated: GET tools/list + SSE stay
 * reachable so clients can still introspect. An empty engine (nothing
 * tracked yet, feeds disabled in dev) is honest-empty — tools return
 * [] rather than a 503.
 */

import type { Context, MiddlewareHandler } from "hono";
import { refuse } from "../lib/error-response";
import {
  bstockFeedDown,
  type BstockFeedEngine,
  type BstockDeltaLike,
} from "../lib/data-status";

export function bstockFeedHealth<
  V extends BstockDeltaLike,
  E = unknown,
  H = unknown,
>(engine: BstockFeedEngine<V, E, H>): MiddlewareHandler {
  return async (c: Context, next) => {
    if (c.req.method === "POST" && bstockFeedDown(engine.listDeltas())) {
      return refuse(
        c,
        "data_unavailable",
        "bstock feed is down — every tracked symbol is stale",
        { hint: "Retry shortly; feeds refresh continuously." },
      );
    }
    await next();
  };
}
