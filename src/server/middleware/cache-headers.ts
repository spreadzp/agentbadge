/**
 * Cache headers middleware — SLICE-47-8
 *
 * Adds Cache-Control headers to long-lived responses.
 * Static and discovery endpoints get longer cache, dynamic API gets short/no cache.
 */
import type { Context, Next } from "hono";

const LONG_LIVED_PATHS = [
  "/llms.txt",
  "/llms-full.txt",
  "/skill.md",
  "/heartbeat.md",
  "/skill.json",
  "/agents.json",
  "/agents.rss",
  "/market/tasks.json",
  "/market/tasks.rss",
  "/.well-known/agent-card.json",
  "/.well-known/mcp.json",
  "/.well-known/oauth-authorization-server",
  "/.well-known/llm-policy.json",
  "/.well-known/webfinger",
  "/.well-known/did.json",
  "/ai-sitemap.xml",
  "/robots.txt",
  "/sitemap.xml",
  "/ai.txt",
  "/catalog",
  "/pricing.json",
];

const API_PREFIXES = ["/api/", "/passport/", "/verify/", "/agents/", "/market/", "/a2a/", "/did/"];

/**
 * Pollable/mutable inbox surfaces — any positive max-age serves stale
 * state (found via browser smoke: a cached "submitted" poll response
 * hid a completed answer for up to 60s; QA retract lagged the same).
 */
const NO_STORE_PREFIXES = [
  "/api/requests",
  "/api/surveys",
  "/api/ops/requests",
  "/api/ops/surveys",
  // EPIC-226 prod-verify A4: admin surfaces are operator-scoped — the
  // default `public, max-age=300` also leaked onto adminAuth 401s.
  "/admin/",
  // EPIC-227 prod-verify (DELTA-MEDIUM, converged by ALPHA): the
  // settlement + commerce surfaces are participant-scoped behind
  // wallet signatures — `public, max-age=60` with no Vary lets a
  // shared cache serve one participant's view (or the 401/404
  // existence-oracle answer) to another client.
  "/api/settlement",
  "/api/commerce",
];

export function cacheHeadersMiddleware() {
  return async (c: Context, next: Next): Promise<Response | void> => {
    await next();

    const path = new URL(c.req.url).pathname;

    // Don't override if already set
    if (c.res.headers.get("Cache-Control")) return;

    // Long-lived static/discovery endpoints
    if (LONG_LIVED_PATHS.includes(path)) {
      c.header("Cache-Control", "public, max-age=3600");
      return;
    }

    if (NO_STORE_PREFIXES.some((p) => path.startsWith(p))) {
      c.header("Cache-Control", "no-store");
      return;
    }

    // API endpoints — short cache
    if (API_PREFIXES.some((p) => path.startsWith(p))) {
      c.header("Cache-Control", "public, max-age=60");
      c.header("X-RateLimit-Limit", "60");
      c.header("X-RateLimit-Remaining", "59");
      return;
    }

    // Default for pages
    c.header("Cache-Control", "public, max-age=300");
  };
}
