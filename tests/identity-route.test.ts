import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { requirePayment } from "@agentbadge/circle-payments";
import { createIdentityRoutes } from "../src/server/routes/identity";

const SELLER = "0x1111111111111111111111111111111111111111";
const AGENT = "0x2222222222222222222222222222222222222222";

const PASSPORT = {
  passportTokenId: "0.0.12345",
  readinessScore: 87,
  mintTx: "0xdeadbeef",
  issuedAt: "2026-09-01T00:00:00Z",
  chain: "hedera:testnet",
};

function makeApp(lookup: ReturnType<typeof vi.fn>) {
  const payment = requirePayment("$0.001", {
    sellerAddress: SELLER,
    gateway: false,
    arc: false,
    handles: {
      exact: {
        verify: vi.fn().mockResolvedValue({ isValid: true, payer: AGENT }),
        settle: vi.fn().mockResolvedValue({
          success: true,
          transaction: "0xtx",
          payer: AGENT,
        }),
      },
    } as never,
  });
  const app = new Hono();
  app.route(
    "/",
    createIdentityRoutes({
      // dual hono installs (file: dep) — nominal type mismatch only
      payment: payment as unknown as Parameters<
        typeof createIdentityRoutes
      >[0]["payment"],
      lookup,
    }),
  );
  return app;
}

const b64 = (o: unknown) =>
  Buffer.from(JSON.stringify(o)).toString("base64");

const paidHeaders = {
  "payment-signature": b64({
    x402Version: 2,
    accepted: {
      scheme: "exact",
      network: "eip155:84532",
      asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      extra: { name: "USDC", version: "2" },
    },
    payload: {},
  }),
};

describe("GET /api/identity/:address", () => {
  it("unpaid → 402 with PAYMENT-REQUIRED", async () => {
    const app = makeApp(vi.fn().mockResolvedValue(PASSPORT));
    const res = await app.request(`/api/identity/${AGENT}`);
    expect(res.status).toBe(402);
    expect(res.headers.get("PAYMENT-REQUIRED")).toBeTruthy();
  });

  it("paid + passport found → 200 with passport JSON", async () => {
    const lookup = vi.fn().mockResolvedValue(PASSPORT);
    const app = makeApp(lookup);
    const res = await app.request(`/api/identity/${AGENT}`, {
      headers: paidHeaders,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.address).toBe(AGENT);
    expect(body.passportTokenId).toBe("0.0.12345");
    expect(body.readinessScore).toBe(87);
    expect(body.mintTx).toBe("0xdeadbeef");
    expect(body.chain).toBe("hedera:testnet");
    expect(body.verifiedAt).toBeTruthy();
    expect(lookup).toHaveBeenCalledWith(AGENT);
  });

  it("paid + no passport → 404", async () => {
    const app = makeApp(vi.fn().mockResolvedValue(undefined));
    const res = await app.request(`/api/identity/${AGENT}`, {
      headers: paidHeaders,
    });
    expect(res.status).toBe(404);
  });

  it("malformed address → 400 (after payment)", async () => {
    const app = makeApp(vi.fn().mockResolvedValue(PASSPORT));
    const res = await app.request("/api/identity/not-an-address", {
      headers: paidHeaders,
    });
    expect(res.status).toBe(400);
  });
});
