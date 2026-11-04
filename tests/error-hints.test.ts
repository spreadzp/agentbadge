/**
 * SLICE-206-11 (EPIC-206): error-hints middleware.
 *
 * Contracts:
 * - JSON 401 bodies gain how_to_fix + register pointer.
 * - JSON 402 bodies gain how_to_fix + payment metadata; the x402
 *   `accepts`/`x402Version` fields survive untouched.
 * - JSON 403 bodies gain how_to_fix + register + trust-tiers pointer.
 * - HTML errors and non-4xx responses are byte-identical.
 * - A route-provided how_to_fix wins over the default.
 */

import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { errorHints } from "../src/server/middleware/error-hints";

function app() {
  const a = new Hono();
  a.use(errorHints());
  a.get("/e401", (c) => c.json({ error: "missing key", code: "agent_key_invalid" }, 401));
  a.get("/e402", (c) =>
    c.json(
      {
        x402Version: 1,
        accepts: [
          {
            scheme: "exact",
            network: "eip155:5042",
            maxAmountRequired: "10000",
            payTo: "0xabc",
          },
        ],
      },
      402,
    ),
  );
  a.get("/e403", (c) => c.json({ error: "passport required", code: "passport_not_found" }, 403));
  a.get("/e403-custom", (c) =>
    c.json({ error: "x", code: "y", how_to_fix: "do this instead" }, 403),
  );
  a.get("/e404-html", (c) => c.html("<h1>nope</h1>", 404));
  a.get("/ok", (c) => c.json({ ok: true }));
  a.get("/e500", (c) => c.json({ error: "boom" }, 500));
  return a;
}

describe("errorHints middleware", () => {
  it("enriches JSON 401 with how_to_fix + register", async () => {
    const res = await app().request("/e401");
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("missing key");
    expect(body.code).toBe("agent_key_invalid");
    expect(body.how_to_fix).toContain("Bearer agb_");
    expect(body.register).toBe("/api/v1/agents/register");
    expect(body.docs).toContain("/agent-guide/getting-started");
  });

  it("enriches JSON 402 with payment metadata, keeps x402 fields", async () => {
    const res = await app().request("/e402");
    expect(res.status).toBe(402);
    const body = await res.json();
    expect(body.x402Version).toBe(1);
    expect(Array.isArray(body.accepts)).toBe(true);
    expect(body.accepts[0].scheme).toBe("exact");
    expect(body.payment.protocol).toBe("x402");
    expect(body.payment.asset).toBe("USDC");
    expect(body.payment.network).toBe("eip155:5042");
    expect(body.payment.pricing).toBe("/pricing.json");
    expect(body.how_to_fix).toContain("PAYMENT-SIGNATURE");
  });

  it("enriches JSON 403 with how_to_fix + register + trust_tiers", async () => {
    const res = await app().request("/e403");
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.how_to_fix).toContain("observer tier");
    expect(body.register).toBe("/api/v1/agents/register");
    expect(body.trust_tiers).toBe("/api/meta/trust-tiers");
  });

  it("route-provided how_to_fix wins over the default", async () => {
    const res = await app().request("/e403-custom");
    const body = await res.json();
    expect(body.how_to_fix).toBe("do this instead");
    expect(body.register).toBe("/api/v1/agents/register");
  });

  it("leaves HTML errors untouched", async () => {
    const res = await app().request("/e404-html");
    expect(res.status).toBe(404);
    const text = await res.text();
    expect(text).toBe("<h1>nope</h1>");
    expect(res.headers.get("content-type")).toContain("text/html");
  });

  it("leaves 2xx and non-target statuses untouched", async () => {
    const ok = await app().request("/ok");
    expect(await ok.json()).toEqual({ ok: true });
    const e500 = await app().request("/e500");
    const b = await e500.json();
    expect(b.how_to_fix).toBeUndefined();
    expect(b.error).toBe("boom");
  });
});
