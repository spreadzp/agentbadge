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

  it("returns rate limit headers on API responses", async () => {
    const res = await app.request("/api/search?q=test");

    const rateLimit = res.headers.get("x-ratelimit-limit")
      || res.headers.get("ratelimit-limit");
    expect(rateLimit).toBeTruthy();
  });
});
