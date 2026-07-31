import type { MiddlewareHandler } from "hono";

const CSP_DIRECTIVES = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://unpkg.com/htmx.org",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:",
  "font-src 'self' https:",
  "connect-src 'self' https://*.hedera.com",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

export function securityHeaders(): MiddlewareHandler {
  return async (c, next) => {
    await next();
    c.header("Content-Security-Policy", CSP_DIRECTIVES);
    c.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    c.header("X-Frame-Options", "DENY");
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Referrer-Policy", "strict-origin-when-cross-origin");
  };
}
