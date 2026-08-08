import { describe, it, expect, beforeAll } from "vitest";
import { Hono } from "hono";
import { contentNegotiationMiddleware } from "../src/server/middleware/content-negotiation";

describe("Content negotiation", () => {
  let app: Hono;

  beforeAll(() => {
    app = new Hono();
    app.use("*", contentNegotiationMiddleware());
    // Simulate the homepage HTML handler
    app.get("/", (c) => c.html("<html><body>Homepage</body></html>"));
    app.get("/other", (c) => c.html("<html>Other</html>"));
  });

  it("returns markdown when Accept: text/markdown first", async () => {
    const res = await app.request("/", {
      headers: { Accept: "text/markdown, text/html, */*" },
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/markdown");
    expect((await res.text()).length).toBeGreaterThanOrEqual(20);
  });

  it("returns JSON when Accept: application/json first", async () => {
    const res = await app.request("/", {
      headers: { Accept: "application/json, text/html, */*" },
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = await res.json();
    expect(body.error).toBeUndefined();
    expect(body.name).toBeDefined();
  });

  it("returns text when Accept: text/plain", async () => {
    const res = await app.request("/", {
      headers: { Accept: "text/plain" },
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/plain");
    expect((await res.text()).length).toBeGreaterThanOrEqual(20);
  });

  it("returns HTML when Accept: text/html first", async () => {
    const res = await app.request("/", {
      headers: { Accept: "text/html, text/markdown, */*" },
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
  });

  it("respects q-values", async () => {
    const res = await app.request("/", {
      headers: { Accept: "text/markdown;q=0.5, text/html;q=1.0" },
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
  });

  it("sets Vary: Accept header on negotiated responses", async () => {
    const res = await app.request("/", {
      headers: { Accept: "application/json" },
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("vary")).toContain("Accept");
  });

  it("agent UA gets non-HTML when Accept prefers markdown", async () => {
    const res = await app.request("/", {
      headers: {
        Accept: "text/markdown, text/html, */*",
        "User-Agent": "Claude-User/1.0",
      },
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).not.toContain("text/html");
  });

  it("returns HTML when no Accept header (default behavior)", async () => {
    const res = await app.request("/");

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
  });

  it("does not negotiate for non-homepage paths", async () => {
    const res = await app.request("/other", {
      headers: { Accept: "text/markdown" },
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
  });
});
