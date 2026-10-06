/**
 * Ops bearer auth — shared by /metrics and /api/payments/health
 * (SLICE-160-2, D4-160). Gate: METRICS_BEARER_TOKEN env;
 * unconfigured → 500 (misconfig surfacing, not silent pass),
 * missing/wrong → 401, timing-safe compare.
 */

import { timingSafeEqual } from "node:crypto";
import type { Context, Next } from "hono";

export function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export function opsBearerAuth() {
  return async (c: Context, next: Next): Promise<Response | void> => {
    const token = process.env.METRICS_BEARER_TOKEN;
    if (!token) {
      return c.json({ error: "METRICS_BEARER_TOKEN not configured" }, 500);
    }
    const authHeader = c.req.header("Authorization");
    const bearer = authHeader?.startsWith("Bearer ")
      ? authHeader.slice(7)
      : null;
    if (!bearer || !safeCompare(bearer, token)) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    await next();
  };
}
