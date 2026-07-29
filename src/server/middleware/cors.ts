/**
 * CORS middleware — configurable allowed origins.
 *
 * Reference: SLICE-7-12
 *
 * Uses `CORS_ALLOWED_ORIGINS` env var (comma-separated).
 * Default: `*` (all origins) for development.
 * In production, set `CORS_ALLOWED_ORIGINS=https://app.example.com,https://admin.example.com`.
 */
import type { Context, Next } from "hono";

const DEFAULT_METHODS = "GET, POST, PUT, DELETE, OPTIONS";
const DEFAULT_HEADERS = "Content-Type, Authorization, X-Admin-Key";
const MAX_AGE = "86400";

function getAllowedOrigins(): string[] {
  const raw = process.env.CORS_ALLOWED_ORIGINS;
  if (!raw) return [];
  return raw
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
}

function isOriginAllowed(origin: string, allowed: string[]): boolean {
  if (allowed.length === 0) return true;
  return allowed.includes(origin);
}

export function corsMiddleware() {
  return async (c: Context, next: Next): Promise<Response | void> => {
    const origin = c.req.header("Origin");
    const allowed = getAllowedOrigins();
    const isWildcard = allowed.length === 0;

    if (isWildcard) {
      c.header("Access-Control-Allow-Origin", "*");
      c.header("Access-Control-Allow-Methods", DEFAULT_METHODS);
      c.header("Access-Control-Allow-Headers", DEFAULT_HEADERS);
      c.header("Access-Control-Max-Age", MAX_AGE);
    } else if (origin && isOriginAllowed(origin, allowed)) {
      c.header("Access-Control-Allow-Origin", origin);
      c.header("Access-Control-Allow-Methods", DEFAULT_METHODS);
      c.header("Access-Control-Allow-Headers", DEFAULT_HEADERS);
      c.header("Access-Control-Max-Age", MAX_AGE);
    }

    if (c.req.method === "OPTIONS") {
      return c.body(null, 204);
    }

    await next();
  };
}
