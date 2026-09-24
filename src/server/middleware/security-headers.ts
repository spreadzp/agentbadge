import type { MiddlewareHandler } from "hono";

const CSP_DIRECTIVES = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://unpkg.com https://www.googletagmanager.com",
  "script-src-elem 'self' 'unsafe-inline' https://unpkg.com https://plausible.io https://www.googletagmanager.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:",
  "font-src 'self' https:",
  "connect-src 'self' https://*.hedera.com https://plausible.io https://www.google-analytics.com https://*.google-analytics.com https://analytics.google.com",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const PERMISSIONS_POLICY = [
  "camera=()",
  "microphone=()",
  "geolocation=()",
  "interest-cohort=()",
  "payment=(self)",
  "usb=()",
  "magnetometer=()",
  "gyroscope=()",
  "accelerometer=()",
].join(", ");

export function securityHeaders(): MiddlewareHandler {
  return async (c, next) => {
    await next();
    c.header("Content-Security-Policy", CSP_DIRECTIVES);
    c.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    c.header("X-Frame-Options", "DENY");
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Referrer-Policy", "strict-origin-when-cross-origin");
    c.header("Permissions-Policy", PERMISSIONS_POLICY);
    c.header("Cross-Origin-Opener-Policy", "same-origin");
    c.header("Cross-Origin-Embedder-Policy", "credentialless");
    // Public assets under /images/ must be embeddable on external sites
    // (Velog, Medium, dev.to syndication). Everything else stays same-origin.
    const corp = c.req.path.startsWith("/images/") ? "cross-origin" : "same-origin";
    c.header("Cross-Origin-Resource-Policy", corp);
    c.header("X-DNS-Prefetch-Control", "off");
    c.header("X-Permitted-Cross-Domain-Policies", "none");
  };
}
