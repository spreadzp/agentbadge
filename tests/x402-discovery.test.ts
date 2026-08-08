import { describe, it, expect, beforeAll } from "vitest";
import { Hono } from "hono";
import { wellKnownRoutes } from "../src/server/routes/well-known";

describe("x402 payment discovery", () => {
  let app: Hono;

  beforeAll(() => {
    app = new Hono();
    app.route("/", wellKnownRoutes);

    // Simulate a 402 response for paid endpoint
    app.post("/passport/request", (c) => {
      // Check if payment proof is provided
      const paymentHeader = c.req.header("x-payment");
      if (!paymentHeader) {
        const challenge = {
          x402Version: 1,
          accepts: [
            {
              scheme: "exact",
              payTo: process.env.x402_TREASURY ?? "0.0.1234",
              maxAmountRequired: "5000000",
              asset: "0.0.0",
              network: "hedera:testnet",
              description: "Agent Passport NFT issuance",
              mimeType: "application/json",
            },
          ],
        };
        const encoded = btoa(JSON.stringify(challenge));
        c.header("Payment-Required", encoded);
        c.header("WWW-Authenticate", `x402 realm="agentbadge"`);
        return c.json(challenge, 402);
      }
      return c.json({ ok: true });
    });
  });

  it("serves /.well-known/x402.json", async () => {
    const res = await app.request("/.well-known/x402.json");

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = await res.json();
    expect(body.x402Version).toBeTruthy();
    expect(body.name).toBeTruthy();
    expect(body.network).toBeTruthy();
    expect(body.facilitator).toBeTruthy();
    expect(body.payTo).toBeTruthy();
    expect(body.services).toBeInstanceOf(Array);
    expect(body.services.length).toBeGreaterThan(0);
  });

  it("services have method, path, description, and amount", async () => {
    const body = await (await app.request("/.well-known/x402.json")).json();
    for (const svc of body.services) {
      expect(svc.method).toBeTruthy();
      expect(svc.path).toBeTruthy();
      expect(svc.description).toBeTruthy();
      expect(svc.amount).toBeTruthy();
    }
  });

  it("paid endpoint returns 402 without payment", async () => {
    const res = await app.request("/passport/request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accountId: "0.0.123", signature: "test", tier: "bronze", name: "test" }),
    });
    expect(res.status).toBe(402);
  });

  it("402 response has decodable Payment-Required header", async () => {
    const res = await app.request("/passport/request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accountId: "0.0.123", signature: "test", tier: "bronze", name: "test" }),
    });
    const paymentHeader = res.headers.get("payment-required");
    expect(paymentHeader).toBeTruthy();
    const decoded = JSON.parse(atob(paymentHeader!));
    expect(decoded.x402Version).toBeTruthy();
    expect(decoded.accepts).toBeInstanceOf(Array);
  });

  it("402 body has x402 challenge JSON", async () => {
    const res = await app.request("/passport/request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accountId: "0.0.123", signature: "test", tier: "bronze", name: "test" }),
    });
    const body = await res.json();
    expect(body.x402Version).toBeTruthy();
    expect(body.accepts).toBeInstanceOf(Array);
    expect(body.accepts[0].payTo).toBeTruthy();
    expect(body.accepts[0].maxAmountRequired).toBeTruthy();
  });
});
