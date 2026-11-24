import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { wireStaticOps } from "../../../src/server/wiring/ops";

describe("static /keys/* (published signer sets)", () => {
  const app = new Hono();
  wireStaticOps(app);

  it("serves /keys/verdict-signers.json with a short cache", async () => {
    const res = await app.request("/keys/verdict-signers.json");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=300");
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toHaveProperty("current");
  });
});

describe("static /.well-known/x402-payto.json (258-24 probe finding)", () => {
  const app = new Hono();
  wireStaticOps(app);

  it("GET serves the proof JSON with a short public cache", async () => {
    const res = await app.request("/.well-known/x402-payto.json");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(res.headers.get("cache-control")).toBe("public, max-age=300");
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.version).toBe(1);
    expect(Array.isArray(body.payTo)).toBe(true);
  });

  it("non-GET methods get 405, not the file (serveStatic is method-agnostic)", async () => {
    for (const method of ["PUT", "DELETE", "PATCH", "POST"]) {
      const res = await app.request("/.well-known/x402-payto.json", { method });
      expect(res.status).toBe(405);
      expect(res.headers.get("allow")).toContain("GET");
    }
  });
});
