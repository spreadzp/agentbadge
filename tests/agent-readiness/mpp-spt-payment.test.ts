import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import { mppPaymentMiddleware } from "../../src/server/middleware/mpp";

/**
 * SLICE-49-18: MPP + SPT payment middleware
 *
 * AgentGrade checks:
 * - "MPP": 402 response has WWW-Authenticate: Payment header
 * - "SPT (Stripe)": 402 response has method="stripe" in WWW-Authenticate
 */

function createTestApp() {
  const app = new Hono();

  const mppConfig = {
    secretKey: "test-secret-key",
    recipientAddress: "0x1234567890abcdef",
    amount: "0.01",
    stripeSecretKey: "sk_test_123",
  };

  app.use(
    "/passport/request",
    mppPaymentMiddleware(mppConfig),
  );

  app.post("/passport/request", (c) => {
    return c.json({ ok: true }, 200);
  });

  return app;
}

describe("SLICE-49-18: MPP + SPT payment middleware", () => {
  let app: Hono;

  beforeEach(() => {
    app = createTestApp();
  });

  it("returns 402 on paid endpoint without payment", async () => {
    const res = await app.request("/passport/request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accountId: "0.0.123", tier: "bronze" }),
    });
    expect(res.status).toBe(402);
  });

  it("402 response has WWW-Authenticate header", async () => {
    const res = await app.request("/passport/request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accountId: "0.0.123", tier: "bronze" }),
    });
    const wwwAuth = res.headers.get("www-authenticate");
    expect(wwwAuth).toBeTruthy();
  });

  it("WWW-Authenticate contains Payment", async () => {
    const res = await app.request("/passport/request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accountId: "0.0.123", tier: "bronze" }),
    });
    const wwwAuth = res.headers.get("www-authenticate") ?? "";
    expect(wwwAuth.toLowerCase()).toContain("payment");
  });

  it("WWW-Authenticate supports stripe method", async () => {
    const res = await app.request("/passport/request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accountId: "0.0.123", tier: "bronze" }),
    });
    const wwwAuth = res.headers.get("www-authenticate") ?? "";
    expect(wwwAuth.toLowerCase()).toContain("stripe");
  });

  it("402 response has Payment-Required header (x402 compat)", async () => {
    const res = await app.request("/passport/request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accountId: "0.0.123", tier: "bronze" }),
    });
    const payReq = res.headers.get("payment-required");
    expect(payReq).toBeTruthy();
  });

  it("402 response body is valid JSON with x402Version", async () => {
    const res = await app.request("/passport/request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accountId: "0.0.123", tier: "bronze" }),
    });
    const body = await res.json();
    expect(body).toHaveProperty("x402Version");
    expect(body).toHaveProperty("accepts");
  });

  it("402 response includes amount in accepts", async () => {
    const res = await app.request("/passport/request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accountId: "0.0.123", tier: "bronze" }),
    });
    const body = await res.json();
    expect(body.accepts[0]).toHaveProperty("maxAmountRequired");
  });

  it("402 response includes bazaar extensions", async () => {
    const res = await app.request("/passport/request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accountId: "0.0.123", tier: "bronze" }),
    });
    const body = await res.json();
    expect(body).toHaveProperty("extensions");
    expect(body.extensions).toHaveProperty("bazaar");
    expect(body.extensions.bazaar).toHaveProperty("discoverable");
    expect(body.extensions.bazaar.discoverable).toBe(true);
  });

  it("passes through when valid payment header is present", async () => {
    const res = await app.request("/passport/request", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-PAYMENT": "valid-payment-token",
      },
      body: JSON.stringify({ accountId: "0.0.123", tier: "bronze" }),
    });
    expect(res.status).toBe(200);
  });

  it("WWW-Authenticate includes tempo method (MPP)", async () => {
    const res = await app.request("/passport/request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accountId: "0.0.123", tier: "bronze" }),
    });
    const wwwAuth = res.headers.get("www-authenticate") ?? "";
    expect(wwwAuth.toLowerCase()).toContain("tempo");
  });
});
