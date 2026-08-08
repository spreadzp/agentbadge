import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import { mppPaymentMiddleware } from "../../src/server/middleware/mpp";
import { bazaarExtensionMiddleware } from "../../src/server/middleware/bazaar-extension";

/**
 * SLICE-49-21: Bazaar in live 402 header
 *
 * AgentGrade checks:
 * - 402 Payment-Required header (base64) contains extensions.bazaar.discoverable
 * - 402 JSON body contains extensions.bazaar.discoverable
 */

function createMppApp() {
  const app = new Hono();
  app.use(
    "/passport/request",
    mppPaymentMiddleware({
      secretKey: "test-secret",
      recipientAddress: "0x1234",
      amount: "0.01",
    }),
  );
  app.post("/passport/request", (c) => c.json({ ok: true }, 200));
  return app;
}

function createBazaarApp() {
  const app = new Hono();
  app.use(bazaarExtensionMiddleware());
  app.post("/paid-endpoint", (c) => {
    return c.json({ error: "payment required" }, 402);
  });
  app.get("/free-endpoint", (c) => c.json({ ok: true }, 200));
  return app;
}

describe("SLICE-49-21: Bazaar in live 402 header", () => {
  describe("MPP middleware 402 response", () => {
    let app: Hono;

    beforeEach(() => {
      app = createMppApp();
    });

    it("402 Payment-Required header includes bazaar extension", async () => {
      const res = await app.request("/passport/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId: "0.0.123", tier: "bronze" }),
      });
      expect(res.status).toBe(402);
      const paymentHeader = res.headers.get("payment-required");
      expect(paymentHeader).toBeTruthy();
      const decoded = JSON.parse(
        Buffer.from(paymentHeader!, "base64").toString(),
      );
      expect(decoded.extensions).toBeTruthy();
      expect(decoded.extensions.bazaar).toBeTruthy();
      expect(decoded.extensions.bazaar.discoverable).toBe(true);
    });

    it("402 JSON body includes bazaar extension", async () => {
      const res = await app.request("/passport/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId: "0.0.123", tier: "bronze" }),
      });
      const body = await res.json();
      expect(body.extensions).toBeTruthy();
      expect(body.extensions.bazaar).toBeTruthy();
      expect(body.extensions.bazaar.discoverable).toBe(true);
    });
  });

  describe("Bazaar extension middleware (any 402)", () => {
    let app: Hono;

    beforeEach(() => {
      app = createBazaarApp();
    });

    it("injects bazaar into 402 JSON body", async () => {
      const res = await app.request("/paid-endpoint", {
        method: "POST",
      });
      expect(res.status).toBe(402);
      const body = await res.json();
      expect(body.extensions).toBeTruthy();
      expect(body.extensions.bazaar).toBeTruthy();
      expect(body.extensions.bazaar.discoverable).toBe(true);
    });

    it("injects bazaar into 402 Payment-Required header", async () => {
      const res = await app.request("/paid-endpoint", {
        method: "POST",
      });
      const paymentHeader = res.headers.get("payment-required");
      expect(paymentHeader).toBeTruthy();
      const decoded = JSON.parse(
        Buffer.from(paymentHeader!, "base64").toString(),
      );
      expect(decoded.extensions.bazaar.discoverable).toBe(true);
    });

    it("injects bazaar into 402 WWW-Authenticate header", async () => {
      const res = await app.request("/paid-endpoint", {
        method: "POST",
      });
      const wwwAuth = res.headers.get("www-authenticate");
      expect(wwwAuth).toBeTruthy();
      expect(wwwAuth).toContain("Payment");
    });

    it("does not modify non-402 responses", async () => {
      const res = await app.request("/free-endpoint");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.extensions).toBeUndefined();
    });
  });
});
