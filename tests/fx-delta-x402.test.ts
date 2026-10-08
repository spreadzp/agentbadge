/**
 * SLICE-191-6: Celo x402 self-settle — verify/settle/tag/replay tests.
 * Injectable clients; no network.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import {
  createCeloX402Facilitator,
  CELO_X402_ASSETS,
} from "../src/server/lib/fx-delta/celo-settle";
import { resetFxDeltaFacilitator } from "../src/server/lib/fx-delta/facilitator-env";
import { fxDeltaRoutes } from "../src/server/routes/fx-delta-api";
import {
  setFxDeltaRuntime,
  resetFxDeltaRuntime,
} from "../src/server/lib/fx-delta";

const PAY_TO = "0x9999999999999999999999999999999999999999";
const PAYER = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

function auth(over: Partial<Record<string, string>> = {}) {
  return {
    from: PAYER,
    to: PAY_TO,
    value: "5000", // 0.005 USDC (6 dec)
    validAfter: "0",
    validBefore: String(Math.floor(Date.now() / 1000) + 300),
    nonce: "0x" + "11".repeat(32),
    ...over,
  };
}

function header(over: Partial<Record<string, string>> = {}, sig?: string) {
  return Buffer.from(
    JSON.stringify({
      x402Version: 2,
      scheme: "exact",
      network: "eip155:42220",
      payload: {
        authorization: auth(over),
        signature: sig ?? "0x" + "ab".repeat(65),
      },
    }),
  ).toString("base64");
}

const REQS = {
  scheme: "exact",
  network: "eip155:42220",
  asset: CELO_X402_ASSETS.USDC.address,
  amount: "5000",
  maxAmountRequired: "5000",
  payTo: PAY_TO,
  resource: "GET /api/fx-delta/premium",
  description: "test",
  mimeType: "application/json",
};

function makeFacilitator(opts: {
  sigOk?: boolean;
  sent?: { to: string; data: string }[];
  receiptStatus?: string;
}) {
  const sent = opts.sent ?? [];
  const fac = createCeloX402Facilitator({
    sellerAddress: PAY_TO,
    attributionCode: "celo_fxdelta",
    publicClient: {
      verifyTypedData: async () => opts.sigOk !== false,
      waitForTransactionReceipt: async () => ({
        status: opts.receiptStatus ?? "success",
      }),
    },
    walletClient: {
      sendTransaction: async (args) => {
        sent.push({ to: args.to, data: args.data });
        return "0x" + "cc".repeat(32) as `0x${string}`;
      },
    },
  });
  return { fac, sent };
}

describe("celo self-settle verify", () => {
  it("valid auth → valid:true + payer", async () => {
    const { fac } = makeFacilitator({});
    const r = await fac.verify(header(), REQS);
    expect(r).toMatchObject({ valid: true, payer: PAYER });
  });

  it("bad header → refuse", async () => {
    const { fac } = makeFacilitator({});
    expect((await fac.verify("not-base64", REQS)).valid).toBe(false);
  });

  it("wrong payTo → refuse BEFORE submit", async () => {
    const sent: { to: string; data: string }[] = [];
    const { fac } = makeFacilitator({ sent });
    const r = await fac.verify(header({ to: "0xdeaddeaddeaddeaddeaddeaddeaddeaddeaddead" }), REQS);
    expect(r.valid).toBe(false);
    expect(r.error).toBe("payto_mismatch");
    expect(sent).toHaveLength(0);
  });

  it("expired validBefore → refuse", async () => {
    const { fac } = makeFacilitator({});
    const r = await fac.verify(header({ validBefore: "1" }), REQS);
    expect(r.valid).toBe(false);
    expect(r.error).toBe("expired");
  });

  it("insufficient amount → refuse", async () => {
    const { fac } = makeFacilitator({});
    expect((await fac.verify(header({ value: "100" }), REQS)).valid).toBe(false);
  });

  it("invalid signature → refuse, no tx sent", async () => {
    const sent: { to: string; data: string }[] = [];
    const { fac } = makeFacilitator({ sigOk: false, sent });
    const r = await fac.verify(header(), REQS);
    expect(r.valid).toBe(false);
    expect(r.error).toBe("invalid_signature");
    expect(sent).toHaveLength(0);
  });

  it("replay same nonce → second verify refused", async () => {
    const { fac } = makeFacilitator({});
    expect((await fac.verify(header(), REQS)).valid).toBe(true);
    const r2 = await fac.verify(header(), REQS);
    expect(r2.valid).toBe(false);
    expect(r2.error).toBe("nonce_replayed");
  });
});

describe("celo self-settle settle — tagged tx", () => {
  it("submits transferWithAuthorization with ERC-8021 suffix", async () => {
    const sent: { to: string; data: string }[] = [];
    const { fac } = makeFacilitator({ sent });
    const r = await fac.settle(header(), REQS);
    expect(r.success).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to.toLowerCase()).toBe(CELO_X402_ASSETS.USDC.address.toLowerCase());
    // tag suffix: ends with the 8021 marker ×8
    expect(sent[0]!.data.endsWith("80218021802180218021802180218021")).toBe(true);
    // and contains ascii "celo_fxdelta"
    expect(sent[0]!.data).toContain("63656c6f5f667864656c7461");
  });

  it("reverts → success:false", async () => {
    const { fac } = makeFacilitator({ receiptStatus: "reverted" });
    expect((await fac.settle(header(), REQS)).success).toBe(false);
  });

  it("missing attribution code → refuses to submit (191-0 gate)", async () => {
    const sent: { to: string; data: string }[] = [];
    const fac = createCeloX402Facilitator({
      sellerAddress: PAY_TO,
      publicClient: {
        verifyTypedData: async () => true,
        waitForTransactionReceipt: async () => ({ status: "success" }),
      },
      walletClient: {
        sendTransaction: async (a) => {
          sent.push({ to: a.to, data: a.data });
          return "0x" + "cc".repeat(32) as `0x${string}`;
        },
      },
    });
    const r = await fac.settle(header(), REQS);
    expect(r.success).toBe(false);
    expect(r.error).toContain("attribution_code_missing");
    expect(sent).toHaveLength(0);
  });
});

describe("facilitator mode (D-191-1 fallback)", () => {
  it("proxies verify+settle to api.x402.celo.org", async () => {
    const calls: string[] = [];
    const fac = createCeloX402Facilitator({
      sellerAddress: PAY_TO,
      mode: "facilitator",
      facilitatorUrl: "https://api.x402.celo.org",
      facilitatorApiKey: "k",
      fetcher: (async (url: string) => {
        calls.push(url);
        if (url.endsWith("/verify")) {
          return { json: async () => ({ isValid: true, payer: PAYER }) } as never;
        }
        return {
          json: async () => ({
            success: true,
            transaction: "0x" + "dd".repeat(32),
            payer: PAYER,
          }),
        } as never;
      }) as never,
    });
    expect((await fac.verify(header(), REQS)).valid).toBe(true);
    const s = await fac.settle(header(), REQS);
    expect(s.success).toBe(true);
    expect(calls).toEqual([
      "https://api.x402.celo.org/verify",
      "https://api.x402.celo.org/settle",
    ]);
  });
});

describe("/api/fx-delta premium gate", () => {
  beforeEach(() => {
    resetFxDeltaRuntime();
    resetFxDeltaFacilitator();
    delete process.env.FXDELTA_PAY_TO;
    delete process.env.SELLER_PRIVATE_KEY;
    delete process.env.X402_MODE;
  });

  it("no payment → 402 with USDC+USDT accepts", async () => {
    process.env.FXDELTA_PAY_TO = PAY_TO;
    process.env.SELLER_PRIVATE_KEY = "0x" + "01".repeat(32);
    process.env.CELO_RPC_URL = "http://localhost:1"; // unreachable is fine — no RPC on 402 path
    setFxDeltaRuntime({
      engine: {
        getAll: () => [],
        getView: () => null,
        getHistory: () => [],
        getEvents: () => [],
      },
      corridors: [],
      sources: () => ({
        uniswap: { connected: false, lastTickMs: 0 },
        mento: { connected: false, lastTickMs: 0 },
        fxRef: { connected: false, lastTickMs: 0 },
      }),
      startedAtMs: Date.now(),
    });
    const app = new Hono();
    app.route("/", fxDeltaRoutes);
    const r = await app.request("/api/fx-delta/premium");
    expect(r.status).toBe(402);
    const body = await r.json();
    const addrs = body.accepts.map((a: { asset: string }) => a.asset.toLowerCase());
    expect(addrs).toContain(CELO_X402_ASSETS.USDC.address.toLowerCase());
    expect(addrs).toContain(CELO_X402_ASSETS.USDT.address.toLowerCase());
    expect(body.accepts[0].network).toBe("eip155:42220");
  });
});
