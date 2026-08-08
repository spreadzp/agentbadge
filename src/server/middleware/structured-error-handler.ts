/**
 * Structured error handler middleware — SLICE-47-8
 *
 * Returns JSON error responses for 404s when Accept: application/json.
 * Returns HTML for browser requests.
 *
 * Usage: app.notFound(structuredNotFoundHandler())
 */
import type { Context } from "hono";

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

function handleNotFound(c: Context): Response {
  const accept = c.req.header("Accept") ?? "";
  const path = new URL(c.req.url).pathname;

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
    return c.json(
      {
        error: "not_found",
        message: `Resource not found: ${path}`,
        path,
        status: 404,
      },
      404,
      { "Content-Type": "application/json; charset=utf-8" },
    );
  }

  return c.text(`404 Not Found: ${path}`, 404);
}
