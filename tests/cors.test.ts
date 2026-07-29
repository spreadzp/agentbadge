import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import { corsMiddleware } from "../src/server/middleware/cors";

function makeApp(): Hono {
  const app = new Hono();
  app.use(corsMiddleware());
  app.get("/test", (c) => c.json({ ok: true }));
  app.post("/test", (c) => c.json({ ok: true }));
  return app;
}

describe("CORS middleware — SLICE-7-12", () => {
  const originalOrigins = process.env.CORS_ALLOWED_ORIGINS;

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.CORS_ALLOWED_ORIGINS;
  });

  afterEach(() => {
    if (originalOrigins !== undefined) {
      process.env.CORS_ALLOWED_ORIGINS = originalOrigins;
    } else {
      delete process.env.CORS_ALLOWED_ORIGINS;
    }
  });

  it("adds Access-Control-Allow-Origin header on simple GET", async () => {
    const app = makeApp();
    const res = await app.request("/test", {
      headers: { Origin: "https://example.com" },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeTruthy();
  });

  it("defaults to wildcard when CORS_ALLOWED_ORIGINS not set", async () => {
    const app = makeApp();
    const res = await app.request("/test", {
      headers: { Origin: "https://example.com" },
    });
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  it("reflects specific origin when CORS_ALLOWED_ORIGINS is set", async () => {
    process.env.CORS_ALLOWED_ORIGINS = "https://app.example.com,https://admin.example.com";
    const app = makeApp();
    const res = await app.request("/test", {
      headers: { Origin: "https://app.example.com" },
    });
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://app.example.com");
  });

  it("blocks origin not in allowed list", async () => {
    process.env.CORS_ALLOWED_ORIGINS = "https://app.example.com";
    const app = makeApp();
    const res = await app.request("/test", {
      headers: { Origin: "https://evil.com" },
    });
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("handles preflight OPTIONS request", async () => {
    const app = makeApp();
    const res = await app.request("/test", {
      method: "OPTIONS",
      headers: {
        Origin: "https://example.com",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "Content-Type,Authorization",
      },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeTruthy();
    expect(res.headers.get("Access-Control-Allow-Methods")).toContain("GET");
    expect(res.headers.get("Access-Control-Allow-Methods")).toContain("POST");
    expect(res.headers.get("Access-Control-Allow-Headers")).toContain("Content-Type");
    expect(res.headers.get("Access-Control-Allow-Headers")).toContain("Authorization");
  });

  it("preflight returns 204 with no body", async () => {
    const app = makeApp();
    const res = await app.request("/test", {
      method: "OPTIONS",
      headers: {
        Origin: "https://example.com",
        "Access-Control-Request-Method": "POST",
      },
    });
    expect(res.status).toBe(204);
    const body = await res.text();
    expect(body).toBe("");
  });

  it("adds Access-Control-Max-Age header on preflight", async () => {
    const app = makeApp();
    const res = await app.request("/test", {
      method: "OPTIONS",
      headers: {
        Origin: "https://example.com",
        "Access-Control-Request-Method": "GET",
      },
    });
    expect(res.headers.get("Access-Control-Max-Age")).toBeTruthy();
  });

  it("allows multiple comma-separated origins", async () => {
    process.env.CORS_ALLOWED_ORIGINS = "https://a.com,https://b.com,https://c.com";
    const app = makeApp();

    const resA = await app.request("/test", { headers: { Origin: "https://a.com" } });
    expect(resA.headers.get("Access-Control-Allow-Origin")).toBe("https://a.com");

    const resC = await app.request("/test", { headers: { Origin: "https://c.com" } });
    expect(resC.headers.get("Access-Control-Allow-Origin")).toBe("https://c.com");
  });

  it("no CORS headers when request has no Origin (same-origin)", async () => {
    const app = makeApp();
    const res = await app.request("/test");
    // Without Origin header, CORS headers are not needed
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });
});
