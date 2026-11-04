// EPIC-206: global request-pipeline middleware cluster extracted from
// index.ts (ESLint max-lines budget). Registration ORDER is semantic —
// keep it exactly as-is.

import type { Hono } from "hono";
import { requestLoggerMiddleware } from "../middleware/request-logger";
import { trafficLog } from "../middleware/traffic-log";
import { corsMiddleware } from "../middleware/cors";
import { securityHeaders } from "../middleware/security-headers";
import { contentNegotiationMiddleware } from "../middleware/content-negotiation";
import { markdownNegotiation } from "../middleware/markdown-negotiation";
import { errorHints } from "../middleware/error-hints";
import { cacheHeadersMiddleware } from "../middleware/cache-headers";

/**
 * Middleware every request passes through, in order: request logging →
 * durable traffic telemetry → CORS → security headers → content
 * negotiation → markdown transform → JSON error hints → cache headers.
 * MUST be wired after host/path normalization and BEFORE L402,
 * signature verification, rate limits and any route mount.
 */
export function wireRequestPipeline(app: Hono): void {
  app.use(requestLoggerMiddleware());
  // Durable request telemetry → Event table for daily traffic reports
  // (fly logs only keep ~10 min buffer). No-op when DATABASE is off.
  app.use(trafficLog);
  app.use(corsMiddleware());
  app.use(securityHeaders());
  app.use(contentNegotiationMiddleware());
  // SLICE-178-4: Accept: text/markdown negotiation for public HTML pages
  // (post-response transform; homepage '/' is owned by content-negotiation).
  app.use(markdownNegotiation());
  // SLICE-206-11: how_to_fix/register/payment hints on JSON 401/402/403 —
  // wraps everything after it (rate-limit, agentKeyAuth, x402 gates, routes).
  app.use(errorHints());
  app.use(cacheHeadersMiddleware());
}
