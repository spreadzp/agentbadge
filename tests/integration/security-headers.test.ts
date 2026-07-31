import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { securityHeaders } from "../../src/server/middleware/security-headers";

function makeTestApp(): Hono {
  const app = new Hono();
  app.use(securityHeaders());
  app.get("/", (c) => c.text("ok"));
  app.get("/health", (c) => c.json({ status: "healthy" }));
  app.get("/robots.txt", (c) => c.text("User-agent: *\nAllow: /"));
  return app;
}

describe("SLICE-21-6: Security Headers Middleware", () => {
  const app = makeTestApp();

  const REQUIRED_HEADERS = [
    "Content-Security-Policy",
    "Strict-Transport-Security",
    "X-Frame-Options",
    "X-Content-Type-Options",
    "Referrer-Policy",
  ] as const;

  it("GET / contains all 5 security headers", async () => {
    const res = await app.request("/");
    for (const header of REQUIRED_HEADERS) {
      expect(res.headers.get(header)).toBeDefined();
    }
  });

  it("GET /health contains all 5 security headers", async () => {
    const res = await app.request("/health");
    for (const header of REQUIRED_HEADERS) {
      expect(res.headers.get(header)).toBeDefined();
    }
  });

  it("GET /robots.txt contains all 5 security headers", async () => {
    const res = await app.request("/robots.txt");
    for (const header of REQUIRED_HEADERS) {
      expect(res.headers.get(header)).toBeDefined();
    }
  });

  it("X-Frame-Options is DENY", async () => {
    const res = await app.request("/");
    expect(res.headers.get("X-Frame-Options")).toBe("DENY");
  });

  it("X-Content-Type-Options is nosniff", async () => {
    const res = await app.request("/");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("Referrer-Policy is strict-origin-when-cross-origin", async () => {
    const res = await app.request("/");
    expect(res.headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
  });

  it("Strict-Transport-Security has max-age=31536000 with includeSubDomains", async () => {
    const res = await app.request("/");
    const hsts = res.headers.get("Strict-Transport-Security");
    expect(hsts).toContain("max-age=31536000");
    expect(hsts).toContain("includeSubDomains");
  });

  // ─── CSP specifics ────────────────────────────────────────

  it("CSP allows Tailwind CDN", async () => {
    const res = await app.request("/");
    const csp = res.headers.get("Content-Security-Policy") ?? "";
    expect(csp).toContain("https://cdn.tailwindcss.com");
  });

  it("CSP allows HTMX CDN", async () => {
    const res = await app.request("/");
    const csp = res.headers.get("Content-Security-Policy") ?? "";
    expect(csp).toContain("https://unpkg.com/htmx.org");
  });

  it("CSP allows inline styles for Tailwind", async () => {
    const res = await app.request("/");
    const csp = res.headers.get("Content-Security-Policy") ?? "";
    expect(csp).toContain("style-src 'self' 'unsafe-inline'");
  });

  it("CSP allows inline scripts for HTMX", async () => {
    const res = await app.request("/");
    const csp = res.headers.get("Content-Security-Policy") ?? "";
    expect(csp).toContain("script-src 'self' 'unsafe-inline'");
  });

  it("CSP connect-src allows Hedera Mirror Node", async () => {
    const res = await app.request("/");
    const csp = res.headers.get("Content-Security-Policy") ?? "";
    expect(csp).toContain("https://*.hedera.com");
  });

  it("CSP includes frame-ancestors 'none'", async () => {
    const res = await app.request("/");
    const csp = res.headers.get("Content-Security-Policy") ?? "";
    expect(csp).toContain("frame-ancestors 'none'");
  });

  it("CSP includes base-uri 'self'", async () => {
    const res = await app.request("/");
    const csp = res.headers.get("Content-Security-Policy") ?? "";
    expect(csp).toContain("base-uri 'self'");
  });

  it("CSP includes form-action 'self'", async () => {
    const res = await app.request("/");
    const csp = res.headers.get("Content-Security-Policy") ?? "";
    expect(csp).toContain("form-action 'self'");
  });
});
