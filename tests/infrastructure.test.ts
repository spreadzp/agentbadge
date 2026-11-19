import { describe, it, expect, beforeAll } from "vitest";
import { Hono } from "hono";
import { cacheHeadersMiddleware } from "../src/server/middleware/cache-headers";
import { structuredNotFoundHandler } from "../src/server/middleware/structured-error-handler";

describe("Infrastructure", () => {
  let app: Hono;

  beforeAll(() => {
    app = new Hono();
    app.use("*", cacheHeadersMiddleware());

    // Simulate a long-lived route
    app.get("/llms.txt", (c) => c.text("LLM content", 200));
    // Simulate a dynamic API route
    app.get("/api/search", (c) => c.json({ results: [] }));
    // Pollable request-inbox routes (must never be cached)
    app.get("/api/requests/rq_test", (c) => c.json({ state: "submitted" }));
    app.get("/api/requests/qa", (c) => c.json({ results: [] }));
    app.get("/api/surveys/open", (c) => c.json({ surveys: [] }));
    app.get("/api/ops/requests", (c) => c.json({ records: [] }));
    // Simulate a normal page
    app.get("/", (c) => c.html("<html></html>"));

    // Structured 404 handler
    app.notFound(structuredNotFoundHandler());
  });

  it("returns Cache-Control on long-lived responses", async () => {
    const res = await app.request("/llms.txt");
    const cacheControl = res.headers.get("cache-control");
    const etag = res.headers.get("etag");
    const lastModified = res.headers.get("last-modified");
    expect(cacheControl || etag || lastModified).toBeTruthy();
  });

  it("returns JSON 404 for unknown paths with Accept: application/json", async () => {
    const res = await app.request("/nonexistent-path", {
      headers: { Accept: "application/json" },
    });

    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = await res.json();
    expect(body.error).toBeTruthy();
  });

  it("returns HTML 404 for browsers", async () => {
    const res = await app.request("/nonexistent-path", {
      headers: { Accept: "text/html" },
    });

    expect(res.status).toBe(404);
  });

  it.each([
    "/api/requests/rq_test",
    "/api/requests/qa",
    "/api/surveys/open",
    "/api/ops/requests",
  ])("returns no-store on pollable inbox path %s", async (path) => {
    const res = await app.request(path);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("returns rate limit headers on API responses", async () => {
    const res = await app.request("/api/search?q=test");

    const rateLimit = res.headers.get("x-ratelimit-limit")
      || res.headers.get("ratelimit-limit");
    expect(rateLimit).toBeTruthy();
  });

  // ─── SLICE-234-33: well-known method contract ─────────────────
  // /.well-known/* is read-only (RFC 8615) — unsafe methods get a
  // structured 405 instead of a generic 404.

  it.each(["POST", "PUT", "PATCH", "DELETE"])(
    "%s /.well-known/agent-card.json → 405 + Allow: GET, HEAD",
    async (method) => {
      const res = await app.request("/.well-known/agent-card.json", { method });
      expect(res.status).toBe(405);
      expect(res.headers.get("allow")).toBe("GET, HEAD");
      expect(res.headers.get("content-type")).toContain("application/json");
      const body = await res.json();
      expect(body.error).toBe("method_not_allowed");
      expect(body.allowed_methods).toEqual(["GET", "HEAD"]);
      expect(body.documentation).toBe("/agent-guide");
    },
  );

  it("POST /.well-known/nonexistent → 405 (namespace is read-only)", async () => {
    const res = await app.request("/.well-known/never-existed", { method: "POST" });
    expect(res.status).toBe(405);
  });

  it("POST /api/nonexistent → still 404 (outside well-known namespace)", async () => {
    const res = await app.request("/api/nonexistent", {
      method: "POST",
      headers: { Accept: "application/json" },
    });
    expect(res.status).toBe(404);
  });

  it("GET /.well-known/nonexistent → still 404 (GET untouched)", async () => {
    const res = await app.request("/.well-known/never-existed", {
      headers: { Accept: "application/json" },
    });
    expect(res.status).toBe(404);
  });
});
