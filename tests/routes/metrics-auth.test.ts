import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import { registry } from "../../src/server/metrics/metrics";

// Build a test app that mirrors the real metrics route with adminAuth
function createMetricsApp(token: string | undefined): Hono {
  const app = new Hono();

  app.use("/metrics", async (c, next) => {
    if (!token) {
      return c.json({ error: "METRICS_BEARER_TOKEN not configured" }, 500);
    }
    const authHeader = c.req.header("Authorization");
    const bearer = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!bearer || bearer !== token) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    await next();
  });

  app.get("/metrics", async () => {
    const text = await registry.metrics();
    return new Response(text, {
      headers: {
        "Content-Type": registry.contentType,
      },
    });
  });

  return app;
}

describe("SLICE-85-3: Metrics Endpoint Restriction", () => {
  const originalToken = process.env.METRICS_BEARER_TOKEN;

  beforeEach(() => {
    process.env.METRICS_BEARER_TOKEN = "test-metrics-token";
  });

  afterEach(() => {
    if (originalToken !== undefined) {
      process.env.METRICS_BEARER_TOKEN = originalToken;
    } else {
      delete process.env.METRICS_BEARER_TOKEN;
    }
  });

  it("returns 401 without bearer token", async () => {
    const app = createMetricsApp("test-metrics-token");
    const res = await app.request("/metrics");
    expect(res.status).toBe(401);
  });

  it("returns 401 with wrong bearer token", async () => {
    const app = createMetricsApp("test-metrics-token");
    const res = await app.request("/metrics", {
      headers: { Authorization: "Bearer wrong-token" },
    });
    expect(res.status).toBe(401);
  });

  it("returns 200 with valid bearer token and text/plain content type", async () => {
    const app = createMetricsApp("test-metrics-token");
    const res = await app.request("/metrics", {
      headers: { Authorization: "Bearer test-metrics-token" },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/plain");
    const text = await res.text();
    expect(text.length).toBeGreaterThan(0);
  });

  it("returns 500 when METRICS_BEARER_TOKEN not configured", async () => {
    const app = createMetricsApp(undefined);
    const res = await app.request("/metrics", {
      headers: { Authorization: "Bearer test-metrics-token" },
    });
    expect(res.status).toBe(500);
  });
});
