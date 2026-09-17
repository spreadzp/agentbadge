import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { createCirclePaymentsRuntime } from "../src/server/lib/circle-payments";
import { createIdentityRoutes } from "../src/server/routes/identity";
import type { CirclePaymentsConfig } from "../src/config/env";

const SELLER = "0x1111111111111111111111111111111111111111";
const AGENT = "0x2222222222222222222222222222222222222222";

const BASE_CFG: CirclePaymentsConfig = {
  enabled: true,
  gateway: false,
  arc: false,
  identity: false,
  escrow: false,
  gatewayApiUrl: "https://gateway-api-testnet.circle.com",
  arcRpcUrl: "https://rpc.testnet.arc.network",
  arcChainId: 5042002,
  sellerAddress: SELLER,
};

const PASSPORT = {
  passportTokenId: "0.0.12345",
  readinessScore: 87,
};

function fakeHandle() {
  return {
    verify: vi.fn().mockResolvedValue({ isValid: true, payer: AGENT }),
    settle: vi
      .fn()
      .mockResolvedValue({ success: true, transaction: "0xtx", payer: AGENT }),
  };
}

function decode402(res: Response) {
  const header = res.headers.get("PAYMENT-REQUIRED");
  expect(header).toBeTruthy();
  return JSON.parse(Buffer.from(header!, "base64").toString("utf-8"));
}

describe("createCirclePaymentsRuntime", () => {
  it("paymentFor → middleware returning 402 with accepts", async () => {
    const rt = createCirclePaymentsRuntime(BASE_CFG, {
      handles: { exact: fakeHandle() },
    });
    const app = new Hono();
    app.use("/paid", rt.paymentFor("readiness.scan") as never);
    app.get("/paid", (c) => c.json({ ok: true }));
    const res = await app.request("/paid");
    expect(res.status).toBe(402);
    const body = decode402(res);
    expect(body.x402Version).toBe(2);
    expect(body.accepts[0].scheme).toBe("exact");
    expect(body.accepts[0].amount).toBe("10000");
    expect(body.accepts[0].payTo).toBe(SELLER);
  });

  it("unknown price key → throws at wiring time", () => {
    const rt = createCirclePaymentsRuntime(BASE_CFG, {
      handles: { exact: fakeHandle() },
    });
    expect(() => rt.paymentFor("no.such.route")).toThrow(
      /unknown price route/i,
    );
  });

  it("identity flag on + passport → extension in 402", async () => {
    const rt = createCirclePaymentsRuntime(
      { ...BASE_CFG, identity: true },
      {
        handles: { exact: fakeHandle() },
        identityLookup: vi.fn().mockResolvedValue(PASSPORT),
      },
    );
    const app = new Hono();
    app.use("/paid", rt.paymentFor("readiness.scan") as never);
    app.get("/paid", (c) => c.json({ ok: true }));
    const res = await app.request("/paid");
    const body = decode402(res);
    expect(body.extensions?.agentbadge?.passportTokenId).toBe("0.0.12345");
  });

  it("identity flag off → no extension in 402", async () => {
    const rt = createCirclePaymentsRuntime(BASE_CFG, {
      handles: { exact: fakeHandle() },
      identityLookup: vi.fn().mockResolvedValue(PASSPORT),
    });
    const app = new Hono();
    app.use("/paid", rt.paymentFor("readiness.scan") as never);
    app.get("/paid", (c) => c.json({ ok: true }));
    const res = await app.request("/paid");
    const body = decode402(res);
    expect(body.extensions).toBeUndefined();
  });

  it("identity route mounts conditionally → unpaid 402", async () => {
    const rt = createCirclePaymentsRuntime(
      { ...BASE_CFG, identity: true },
      {
        handles: { exact: fakeHandle() },
        identityLookup: vi.fn().mockResolvedValue(PASSPORT),
      },
    );
    const app = new Hono();
    app.route(
      "/",
      createIdentityRoutes({
        payment: rt.paymentFor("identity.verify"),
        lookup: rt.lookup,
      }),
    );
    const res = await app.request(`/api/identity/${AGENT}`);
    expect(res.status).toBe(402);
    const body = decode402(res);
    expect(body.accepts[0].amount).toBe("1000"); // $0.001
  });
});
