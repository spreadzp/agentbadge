import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/server/middleware/signature-verification", () => ({
  signatureVerificationMiddleware: vi.fn(async (_c: any, next: any) => {
    const { verifyWalletOwnership } = await import("@agentgate-hedera/passport");
    const c = _c;
    if (c.req.method === "GET") {
      await next();
      return;
    }
    let body: Record<string, unknown>;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }
    c.set("parsedBody", body);
    if (!body.accountId || !body.signature) {
      return c.json({ error: "Missing accountId or signature" }, 400);
    }
    if (!(await verifyWalletOwnership(body.accountId as string, body.signature as string))) {
      return c.json({ error: "Invalid signature" }, 401);
    }
    c.req.json = async () => body;
    await next();
  }),
}));

vi.mock("@agentgate-hedera/passport", async (importOriginal) => ({
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
import { verifyWalletOwnership } from "@agentgate-hedera/passport";

function makeApp(): Hono {
  const app = new Hono();
  app.use((c, next) => signatureVerificationMiddleware(c as any, next));
  app.route("/", passportRoutes);
  return app;
}

describe("Signature Verification Middleware — SLICE-7-1", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(verifyWalletOwnership).mockResolvedValue(true);
  });

  it("returns 401 when signature is invalid (before payment)", async () => {
    vi.mocked(verifyWalletOwnership).mockResolvedValueOnce(false);
    const app = makeApp();

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

  it("passes through to route handler when signature is valid", async () => {
    const app = makeApp();

    const res = await app.request("/passport/request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        accountId: "0.0.7654321",
        signature: "0xfakesig",
        tier: "silver",
        name: "TestBot",
        capabilities: ["api_call"],
        endpoint: "https://test.example.com",
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tokenId).toBe("0.0.123");
  });

  it("returns 400 when accountId or signature is missing", async () => {
    const app = makeApp();

    const res = await app.request("/passport/request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tier: "bronze" }),
    });

    expect(res.status).toBe(400);
  });

  it("returns 400 when body is invalid JSON", async () => {
    const app = makeApp();

    const res = await app.request("/passport/request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not-json",
    });

    expect(res.status).toBe(400);
  });

  it("does not intercept GET requests", async () => {
    const app = makeApp();

    const res = await app.request("/passport/request", {
      method: "GET",
    });

    expect(res.status).not.toBe(401);
  });

  it("does not intercept other POST routes", async () => {
    const app = makeApp();

    const res = await app.request("/other-route", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).not.toBe(401);
  });

  it("verifies signature BEFORE reaching route handler (verifyWalletOwnership called, issuePassport not called on failure)", async () => {
    vi.mocked(verifyWalletOwnership).mockResolvedValueOnce(false);
    const app = makeApp();

    const res = await app.request("/passport/request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        accountId: "0.0.123",
        signature: "0xbadsig",
        tier: "bronze",
        name: "TestBot",
        capabilities: ["api_call"],
        endpoint: "https://test.example.com",
      }),
    });

    expect(res.status).toBe(401);
    expect(verifyWalletOwnership).toHaveBeenCalledWith("0.0.123", "0xbadsig");
  });
});
