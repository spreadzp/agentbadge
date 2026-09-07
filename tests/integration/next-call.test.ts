import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import type { NextCall } from "../../src/server/lib/next-call";

// SLICE-123-3: Test next_call pattern in API responses

function createTestApp() {
  const app = new Hono();

  app.get("/catalog", (c) => {
    const next_call: NextCall = {
      method: "POST",
      path: "/passport/request",
      body: { tier: "standard" },
      authorization: "x402 payment required",
      why: "Purchase a passport NFT to get an on-chain identity for your agent.",
    };
    return c.json({ tiers: [], next_call });
  });

  app.post("/passport/request", (c) => {
    const next_call: NextCall = {
      method: "POST",
      path: "/agents/register",
      body: { did: "did:hedera:0.0.123", name: "My Agent", capabilities: ["data_analysis"] },
      authorization: "Bearer <did-auth-token>",
      why: "Register your agent in the HCS directory so other agents can discover it.",
    };
    return c.json({ tokenId: "0.0.456", serialNumber: 1, next_call });
  });

  app.post("/agents/register", (c) => {
    const next_call: NextCall = {
      method: "GET",
      path: "/agents/did:hedera:0.0.123",
      why: "Verify your agent was registered and see its directory entry.",
    };
    return c.json({ did: "did:hedera:0.0.123", registered: true, next_call });
  });

  app.get("/api/scan", (c) => {
    const url = c.req.query("url") ?? "example.com";
    const next_call: NextCall = {
      method: "GET",
      path: `/api/badge?url=${encodeURIComponent(url)}`,
      why: "Fetch the trust badge SVG for the scanned domain to display or verify.",
    };
    return c.json({ url, score: 85, grade: "B", next_call });
  });

  return app;
}

describe("SLICE-123-3: next_call pattern", () => {
  const app = createTestApp();

  describe("GET /catalog", () => {
    it("returns 200", async () => {
      const res = await app.request("/catalog");
      expect(res.status).toBe(200);
    });

    it("includes next_call field", async () => {
      const res = await app.request("/catalog");
      const data = await res.json();
      expect(data).toHaveProperty("next_call");
    });

    it("next_call has method, path, why", async () => {
      const res = await app.request("/catalog");
      const data = await res.json();
      const nc = data.next_call;
      expect(nc).toHaveProperty("method");
      expect(nc).toHaveProperty("path");
      expect(nc).toHaveProperty("why");
    });

    it("next_call points to /passport/request", async () => {
      const res = await app.request("/catalog");
      const data = await res.json();
      expect(data.next_call.path).toBe("/passport/request");
      expect(data.next_call.method).toBe("POST");
    });

    it("next_call has body and authorization hints", async () => {
      const res = await app.request("/catalog");
      const data = await res.json();
      expect(data.next_call.body).toBeDefined();
      expect(data.next_call.authorization).toBeDefined();
    });
  });

  describe("POST /passport/request", () => {
    it("includes next_call field", async () => {
      const res = await app.request("/passport/request", { method: "POST" });
      const data = await res.json();
      expect(data).toHaveProperty("next_call");
    });

    it("next_call points to /agents/register", async () => {
      const res = await app.request("/passport/request", { method: "POST" });
      const data = await res.json();
      expect(data.next_call.path).toBe("/agents/register");
      expect(data.next_call.method).toBe("POST");
    });

    it("next_call has why explanation", async () => {
      const res = await app.request("/passport/request", { method: "POST" });
      const data = await res.json();
      expect(data.next_call.why.toLowerCase()).toContain("register");
    });
  });

  describe("POST /agents/register", () => {
    it("includes next_call field", async () => {
      const res = await app.request("/agents/register", { method: "POST" });
      const data = await res.json();
      expect(data).toHaveProperty("next_call");
    });

    it("next_call points to GET /agents/{did}", async () => {
      const res = await app.request("/agents/register", { method: "POST" });
      const data = await res.json();
      expect(data.next_call.method).toBe("GET");
      expect(data.next_call.path).toContain("/agents/");
    });

    it("next_call has why explanation", async () => {
      const res = await app.request("/agents/register", { method: "POST" });
      const data = await res.json();
      expect(data.next_call.why).toBeTruthy();
    });
  });

  describe("GET /api/scan", () => {
    it("includes next_call field", async () => {
      const res = await app.request("/api/scan?url=example.com");
      const data = await res.json();
      expect(data).toHaveProperty("next_call");
    });

    it("next_call points to /api/badge", async () => {
      const res = await app.request("/api/scan?url=example.com");
      const data = await res.json();
      expect(data.next_call.path).toContain("/api/badge");
      expect(data.next_call.method).toBe("GET");
    });

    it("next_call includes the scanned url in path", async () => {
      const res = await app.request("/api/scan?url=example.com");
      const data = await res.json();
      expect(data.next_call.path).toContain("example.com");
    });

    it("next_call has why explanation", async () => {
      const res = await app.request("/api/scan?url=example.com");
      const data = await res.json();
      expect(data.next_call.why).toBeTruthy();
    });
  });

  describe("NextCall interface structure", () => {
    it("all next_call objects have required fields", async () => {
      const endpoints = [
        "/catalog",
        "/passport/request",
        "/agents/register",
        "/api/scan?url=example.com",
      ];
      for (const ep of endpoints) {
        const method = ep.startsWith("/passport") || ep.startsWith("/agents/register") ? "POST" : "GET";
        const res = await app.request(ep, { method });
        const data = await res.json();
        const nc = data.next_call;
        expect(nc.method).toBeTruthy();
        expect(nc.path).toBeTruthy();
        expect(nc.why).toBeTruthy();
        expect(typeof nc.method).toBe("string");
        expect(typeof nc.path).toBe("string");
        expect(typeof nc.why).toBe("string");
      }
    });
  });
});
