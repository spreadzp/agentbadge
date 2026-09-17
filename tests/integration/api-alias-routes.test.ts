import { describe, it, expect } from "vitest";
import { Hono } from "hono";

// SLICE-121-2: Test the alias route patterns in isolation
// These mirror the routes added to src/server/index.ts
function createAliasApp() {
  const app = new Hono();

  app.get("/api/health", (c) => {
    return c.json({
      status: "healthy",
      version: "test",
      timestamp: Date.now(),
    });
  });
  app.get("/api/catalog", (c) => c.redirect("/catalog", 301));
  app.get("/api/audit/:tokenId?/:serial?", (c) => {
    const tokenId = c.req.param("tokenId");
    const serial = c.req.param("serial");
    const path = serial ? `/audit/${tokenId}/${serial}` : tokenId ? `/audit/${tokenId}` : "/audit";
    return c.redirect(path, 301);
  });
  app.all("/api/passport/request", (c) => c.redirect("/passport/request", 301));
  // SLICE-131-2: mirrors index.ts — /market landing moved to /services/marketplace
  app.get("/market", (c) => c.redirect("/services/marketplace", 301));
  app.get("/market/tasks", (c) => c.json({ tasks: [] }));

  return app;
}

describe("SLICE-121-2: API alias routes", () => {
  const app = createAliasApp();

  it("/api/health returns 200 with health data", async () => {
    const res = await app.request("/api/health");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("healthy");
  });

  it("/api/catalog returns 301 redirect to /catalog", async () => {
    const res = await app.request("/api/catalog");
    expect(res.status).toBe(301);
    expect(res.headers.get("Location")).toBe("/catalog");
  });

  it("/api/audit/0.0.9681741/1 returns 301 redirect", async () => {
    const res = await app.request("/api/audit/0.0.9681741/1");
    expect(res.status).toBe(301);
    expect(res.headers.get("Location")).toBe("/audit/0.0.9681741/1");
  });

  it("/api/audit returns 301 redirect to /audit", async () => {
    const res = await app.request("/api/audit");
    expect(res.status).toBe(301);
    expect(res.headers.get("Location")).toBe("/audit");
  });

  it("/api/passport/request returns 301 redirect", async () => {
    const res = await app.request("/api/passport/request", { method: "GET" });
    expect(res.status).toBe(301);
    expect(res.headers.get("Location")).toBe("/passport/request");
  });

  // SLICE-131-2
  it("/market returns 301 redirect to /services/marketplace", async () => {
    const res = await app.request("/market");
    expect(res.status).toBe(301);
    expect(res.headers.get("Location")).toBe("/services/marketplace");
  });

  it("/market/tasks is NOT redirected (live API endpoint)", async () => {
    const res = await app.request("/market/tasks");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tasks).toBeDefined();
  });
});
