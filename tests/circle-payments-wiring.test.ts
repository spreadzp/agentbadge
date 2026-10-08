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
  arcMainnet: false,
  arcMainnetRpcUrl: "https://rpc.mainnet.arc.io",
  gatewayMinDepositUsd: "0.10",
  attestation: false,
  sellerAddress: SELLER,
  platformFeeBps: 0,
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
    // ArcSelfSettleHandle fields (171-4): only needed on the arc rail.
    publicClient: {} as never,
    seenTxHashes: new Set<string>(),
    network: "eip155:5042002",
    inspect: vi
      .fn()
      .mockResolvedValue({ ok: true, txHash: "0xtx", payer: AGENT }),
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

describe("routerFor per-rail payTo (SLICE-157-3, D6-157)", () => {
  const SPLITTER = "0x4444444444444444444444444444444444444444";
  const TREASURY = "0x3333333333333333333333333333333333333333";

  it("arcSelfSettle entry carries per-rail payTo, exact keeps default", () => {
    const rt = createCirclePaymentsRuntime({ ...BASE_CFG, arc: true }, {
      handles: { exact: fakeHandle(), arcSelfSettle: fakeHandle() },
    });
    const accepts = rt
      .routerFor(SPLITTER, { arcSelfSettle: TREASURY })
      .acceptsFor("5000000");
    const exact = accepts.find((a) => a.scheme === "exact");
    const arc = accepts.find((a) => a.scheme === "eip3009-client-broadcast");
    expect(exact?.payTo).toBe(SPLITTER);
    expect(arc?.payTo).toBe(TREASURY);
  });

  it("same payTo without perRailPayTo reuses the cached router", () => {
    const rt = createCirclePaymentsRuntime(BASE_CFG, {
      handles: { exact: fakeHandle() },
    });
    expect(rt.routerFor(SPLITTER)).toBe(rt.routerFor(SPLITTER));
    expect(rt.routerFor(SPLITTER, { exact: TREASURY })).not.toBe(
      rt.routerFor(SPLITTER),
    );
  });
});
