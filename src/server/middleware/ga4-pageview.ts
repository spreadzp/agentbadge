/**
 * GA4 pageview tracking middleware.
 *
 * Fires trackPageView() for HTML 200 GET responses (fire-and-forget).
 * Skips API routes, static assets, and non-HTML responses.
 */

import type { MiddlewareHandler } from "hono";
import { trackPageView, isGa4Enabled } from "../lib/google-analytics";

function shouldTrack(path: string, method: string, status: number, contentType: string): boolean {
  if (method !== "GET") return false;
  if (status !== 200) return false;
  if (!contentType.includes("text/html")) return false;
  if (path.startsWith("/api/")) return false;
  if (path.startsWith("/admin")) return false;
  if (path.startsWith("/mcp/")) return false;
  // Skip static file extensions
  if (/\.(xml|txt|json|css|js|png|jpg|jpeg|gif|svg|ico|webp|woff2?|ttf|map)$/i.test(path)) return false;
  return true;
}

export const ga4Pageview: MiddlewareHandler = async (c, next) => {
  if (!isGa4Enabled()) {
    await next();
    return;
  }

  await next();

  const path = c.req.path;
  const method = c.req.method;
  const status = c.res.status;
  const contentType = c.res.headers.get("content-type") ?? "";

  if (!shouldTrack(path, method, status, contentType)) return;

  const referrer = c.req.header("referer");
  void trackPageView(path, path, referrer); // fire-and-forget
};
