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
