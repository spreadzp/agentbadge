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
