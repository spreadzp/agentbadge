import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/server/middleware/signature-verification", () => ({
  signatureVerificationMiddleware: vi.fn(async (_c: any, next: any) => {
    const { verifyWalletOwnership } = await import("@agentbadge/passport");
    const c = _c;
    const body = await c.req.json();
    if (!body.accountId || !body.signature) {
      return c.json({ error: "Missing accountId or signature" }, 400);
    }
    if (!(await verifyWalletOwnership(body.accountId, body.signature))) {
      return c.json({ error: "Invalid signature" }, 401);
    }
    c.req.json = async () => body;
    await next();
  }),
}));

vi.mock("@agentbadge/passport", async (importOriginal) => ({
  ...await importOriginal(),
  verifyWalletOwnership: vi.fn(async () => true),
  issuePassport: vi.fn(async () => ({
    tokenId: "0.0.123",
    serialNumber: 1,
    did: "did:hcs:0.0.123:1",
    tier: "silver",
    hashScanLink: "https://hashscan.io/testnet/token/0.0.123/1",
  })),
}));

import { Hono } from "hono";
import { signatureVerificationMiddleware } from "../src/server/middleware/signature-verification";
import { passportRoutes } from "../src/server/routes/passport";
import { verifyWalletOwnership, issuePassport } from "@agentbadge/passport";

describe("POST /passport/request", () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
    app = new Hono();
    app.use((c, next) => signatureVerificationMiddleware(c as any, next));
    app.route("/", passportRoutes);
  });

  it("returns 401 when signature verification fails (before payment)", async () => {
    vi.mocked(verifyWalletOwnership).mockResolvedValueOnce(false);

    const res = await app.request("/passport/request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        accountId: "0.0.7654321",
        signature: "0xbadsig",
        tier: "silver",
        name: "TestBot",
        capabilities: ["api_call"],
        endpoint: "https://test.example.com",
      }),
    });

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toMatch(/signature/i);
  });

  it("returns 200 with passport data on valid request", async () => {
    const res = await app.request("/passport/request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        accountId: "0.0.7654321",
        signature: "0xfakesig",
        tier: "silver",
        name: "TradingBot",
        capabilities: ["api_call", "payment"],
        endpoint: "https://agent.example.com",
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tokenId).toBe("0.0.123");
    expect(body.serialNumber).toBe(1);
    expect(body.did).toBe("did:hcs:0.0.123:1");
    expect(body.tier).toBe("silver");
    expect(body.hashScanLink).toContain("hashscan.io");
  });

  it("returns 400 when required fields are missing", async () => {
    const res = await app.request("/passport/request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accountId: "0.0.123" }),
    });

    expect(res.status).toBe(400);
  });
});
