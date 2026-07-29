import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import { requestLoggerMiddleware } from "../src/server/middleware/request-logger";

function makeApp(): Hono {
  const app = new Hono();
  app.use(requestLoggerMiddleware());
  app.get("/test", (c) => c.json({ ok: true }));
  app.get("/slow", async (c) => {
    await new Promise((r) => setTimeout(r, 10));
    return c.json({ ok: true });
  });
  app.get("/error", (c) => c.json({ error: "fail" }, 500));
  return app;
}

describe("requestLoggerMiddleware — SLICE-7-5", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it("logs method, path, status, and duration", async () => {
    const app = makeApp();
    await app.request("/test", { method: "GET" });

    expect(logSpy).toHaveBeenCalledOnce();
    const output = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(output.level).toBe("info");
    expect(output.message).toBe("request");
    expect(output.context.method).toBe("GET");
    expect(output.context.path).toBe("/test");
    expect(output.context.status).toBe(200);
    expect(output.context.durationMs).toBeDefined();
  });

  it("logs as structured JSON", async () => {
    const app = makeApp();
    await app.request("/test", { method: "GET" });

    const raw = logSpy.mock.calls[0][0] as string;
    expect(() => JSON.parse(raw)).not.toThrow();
    const parsed = JSON.parse(raw);
    expect(parsed.timestamp).toBeDefined();
    expect(parsed.level).toBeDefined();
  });

  it("redacts Authorization header", async () => {
    const app = makeApp();
    await app.request("/test", {
      method: "GET",
      headers: { Authorization: "Bearer secret-token-123" },
    });

    const output = JSON.parse(logSpy.mock.calls[0][0] as string);
    const headers = JSON.stringify(output.context);
    expect(headers).not.toContain("secret-token-123");
    expect(headers).toContain("[REDACTED]");
  });

  it("redacts X-PAYMENT header", async () => {
    const app = makeApp();
    await app.request("/test", {
      method: "GET",
      headers: { "X-PAYMENT": "sensitive-payment-data" },
    });

    const output = JSON.parse(logSpy.mock.calls[0][0] as string);
    const headers = JSON.stringify(output.context);
    expect(headers).not.toContain("sensitive-payment-data");
    expect(headers).toContain("[REDACTED]");
  });

  it("generates request ID for correlation", async () => {
    const app = makeApp();
    const res = await app.request("/test", { method: "GET" });

    const requestId = res.headers.get("X-Request-Id");
    expect(requestId).toBeDefined();
    expect(requestId).toHaveLength(36); // UUID format

    const output = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(output.context.requestId).toBe(requestId);
  });

  it("logs error status (>=400) with warn level", async () => {
    const app = makeApp();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    await app.request("/error", { method: "GET" });

    expect(warnSpy).toHaveBeenCalledOnce();
    const output = JSON.parse(warnSpy.mock.calls[0][0] as string);
    expect(output.level).toBe("warn");
    expect(output.context.status).toBe(500);
    warnSpy.mockRestore();
  });

  it("includes duration in milliseconds", async () => {
    const app = makeApp();
    await app.request("/slow", { method: "GET" });

    const output = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(output.context.durationMs).toBeGreaterThanOrEqual(5);
  });
});
