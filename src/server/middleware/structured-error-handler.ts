/**
 * Structured error handler middleware — SLICE-47-8
 *
 * Returns JSON error responses for 404s when Accept: application/json.
 * Returns HTML for browser requests.
 *
 * Usage: app.notFound(structuredNotFoundHandler())
 */
import type { Context } from "hono";
import { notFoundSuggestions } from "../lib/not-found-hints";

export function structuredErrorHandler() {
  return async (c: Context, next: () => Promise<void>): Promise<Response | void> => {
    await next();
    if (c.res.status !== 404) return;
    handleNotFound(c);
  };
}

export function structuredNotFoundHandler() {
  return (c: Context): Response => {
    return handleNotFound(c);
  };
}

const WELL_KNOWN_READ_ONLY_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function handleNotFound(c: Context): Response {
  const accept = c.req.header("Accept") ?? "";
  const path = new URL(c.req.url).pathname;

  // SLICE-234-33: well-known namespace is read-only (RFC 8615) — unsafe
  // methods get a structured 405 instead of a generic 404, so agents can
  // tell "resource exists, wrong method" from "resource missing".
  if (path.startsWith("/.well-known/") && !WELL_KNOWN_READ_ONLY_METHODS.has(c.req.method)) {
    return c.json(
      {
        error: "method_not_allowed",
        message: `Method ${c.req.method} not allowed on ${path}`,
        path,
        allowed_methods: ["GET", "HEAD"],
        documentation: "/agent-guide",
      },
      405,
      { Allow: "GET, HEAD", "Content-Type": "application/json; charset=utf-8" },
    );
  }

  // Check text/html first — browsers and explicit HTML requests should get HTML
  if (accept.includes("text/html") || !accept) {
    return c.html(
      `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>404 — Not Found</title>
</head>
<body>
<h1>404 — Not Found</h1>
<p>The page <code>${path}</code> does not exist.</p>
<p><a href="/">Return to homepage</a></p>
</body>
</html>`,
      404,
    );
  }

  if (accept.includes("application/json") || accept.includes("*/*")) {
    // SLICE-234-30: intent-aware suggestions — whitelist only, live
    // endpoints only (guard-test), excluded probes get bare 404.
    const suggestions = notFoundSuggestions(path);
    return c.json(
      {
        error: "not_found",
        message: `Resource not found: ${path}`,
        path,
        status: 404,
        ...(suggestions ? { suggestions } : {}),
      },
      404,
      { "Content-Type": "application/json; charset=utf-8" },
    );
  }

  return c.text(`404 Not Found: ${path}`, 404);
}
