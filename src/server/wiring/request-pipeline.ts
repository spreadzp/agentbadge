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
import { weakEtag } from "../middleware/weak-etag";

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
  // SLICE-259-34 (G7): /api/* is a callable agent surface, not indexable
  // content — robots already disallows crawling, X-Robots-Tag noindex
  // keeps API responses out of the index even via followed links.
  app.use("/api/*", async (c, next) => {
    await next();
    c.header("X-Robots-Tag", "noindex");
  });

  // SLICE-259-37: weak ETag + 304 on byte-stable generated surfaces —
  // agent fleets re-fetch robots/llms/manifests every run; a revalidation
  // must not re-transfer the body (DeepSeek ds8: no ETag → full re-download).
  for (const path of [
    "/robots.txt",
    "/llms.txt",
    "/llms-full.txt",
    "/heartbeat.md",
    "/sitemap.xml",
    "/ai-sitemap.xml",
    "/faq",
    "/skill.md",
    "/.well-known/*",
  ]) {
    app.use(path, weakEtag());
  }
}
