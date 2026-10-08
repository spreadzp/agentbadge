/**
 * SLICE-171-3: payer-binding wired into bstockFreemium paid branch.
 *
 * Cases:
 * - PAYER_BIND_ENABLED off → legacy behavior (no binding check).
 * - signed payment → 200, verify+settle run, dedup consumed once.
 * - payment w/o binding headers → 402 payerBinding declaration,
 *   facilitator.verify NOT called (dedup slot not burned).
 * - foreign key + valid own sig, on-chain payer = victim (peekPayer)
 *   → 403 before verify.
 * - no peekPayer → post-verify payer compare still rejects → 403.
 * - free tier unchanged; every 402 carries the declaration when on.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Hono } from "hono";
import { privateKeyToAccount } from "viem/accounts";
import { verifyMessage } from "viem";
import { buildPayerChallenge } from "@agentbadge/circle-payments";
import {
  bstockFreemium,
  type BstockFacilitator,
  type BstockFreemiumConfig,
} from "../src/server/middleware/bstock-freemium";
import {
  configurePayerBindingForTesting,
  resetPayerBindingForTesting,
} from "../src/server/middleware/payer-binding";
import { resetCacheForTests } from "../src/server/lib/cache";
import { resetConfigCache } from "../src/config/env";

const PAYER_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;
const SNIPER_KEY =
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as const;
const payer = privateKeyToAccount(PAYER_KEY);
const sniper = privateKeyToAccount(SNIPER_KEY);

const PATH = "/api/delta";
const TX_HASH =
  "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const USDC = "0x3600000000000000000000000000000000000000";
const nowSec = () => Math.floor(Date.now() / 1000);

const paymentHeader = (txHash = TX_HASH) =>
  Buffer.from(JSON.stringify({ payload: { txHash } })).toString("base64");

async function signFor(
  account: typeof payer,
  opts: { payRef?: string; timestamp?: number; wallet?: string } = {},
) {
  const timestamp = opts.timestamp ?? nowSec();
  const wallet = opts.wallet ?? account.address;
  const signature = await account.signMessage({
    message: buildPayerChallenge({
      wallet,
      method: "GET",
      path: PATH,
      payRef: opts.payRef ?? TX_HASH,
      timestamp,
    }),
  });
  return { signature, timestamp, wallet };
}

function boundHeaders(
  account: typeof payer,
  wallet = account.address,
) {
  return signFor(account, { wallet }).then((s) => ({
    "payment-signature": paymentHeader(),
    "x-wallet": wallet,
    "x-sig": s.signature,
    "x-timestamp": String(s.timestamp),
  }));
}

interface StubFacilitator extends BstockFacilitator {
  verify: ReturnType<typeof vi.fn>;
  settle: ReturnType<typeof vi.fn>;
  peekPayer?: ReturnType<typeof vi.fn>;
}

function makeFacilitator(withPeek = true): StubFacilitator {
  const f: StubFacilitator = {
    verify: vi
      .fn()
      .mockResolvedValue({ valid: true, payer: payer.address }),
    settle: vi
      .fn()
      .mockResolvedValue({ success: true, transaction: TX_HASH, payer: payer.address }),
  };
  if (withPeek) {
    f.peekPayer = vi.fn().mockResolvedValue(payer.address);
  }
  return f;
}

function makeApp(facilitator: StubFacilitator) {
  const handler = vi.fn((c) => c.json({ ok: true }));
  const cfg: BstockFreemiumConfig = {
    priceUsd: "0.01",
    durationSec: 0,
    payTo: "0x9999999999999999999999999999999999999999",
    networkId: "eip155:5042002",
    usdcAddress: USDC,
    facilitator,
  };
  const app = new Hono();
  app.get(PATH, bstockFreemium(cfg), handler);
  return { app, handler };
}

const localVerifier = (wallet: string, message: string, signature: string) =>
  verifyMessage({
    address: wallet as `0x${string}`,
    message,
    signature: signature as `0x${string}`,
  });

describe("SLICE-171-3: bstockFreemium payer-binding", () => {
  beforeEach(() => {
    vi.stubEnv("PAYER_BIND_ENABLED", "true");
    vi.stubEnv("CACHE_ENABLED", "false");
    resetConfigCache();
    resetCacheForTests();
    configurePayerBindingForTesting({ verifier: localVerifier });
  });
  afterEach(() => {
    resetPayerBindingForTesting();
    vi.unstubAllEnvs();
    resetConfigCache();
    resetCacheForTests();
  });

  it("signed payment → 200, verify+settle called once", async () => {
    const f = makeFacilitator();
    const { app, handler } = makeApp(f);
    const res = await app.request(PATH, {
      headers: await boundHeaders(payer),
    });
    expect(res.status).toBe(200);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(f.peekPayer).toHaveBeenCalledTimes(1);
    expect(f.verify).toHaveBeenCalledTimes(1);
    expect(f.settle).toHaveBeenCalledTimes(1);
  });

  it("payment w/o binding headers → 402 + declaration, verify not called", async () => {
    const f = makeFacilitator();
    const { app } = makeApp(f);
    const res = await app.request(PATH, {
      headers: { "payment-signature": paymentHeader() },
    });
    expect(res.status).toBe(402);
    const body = await res.json();
    expect(body.payerBinding.required).toBe(true);
    expect(body.payerBinding.challenge).toBe("agentbadge-pay:v1");
    expect(f.verify).not.toHaveBeenCalled();
    expect(f.settle).not.toHaveBeenCalled();
  });

  it("foreign key + valid own sig, peekPayer=victim → 403, verify not called", async () => {
    const f = makeFacilitator();
    const { app } = makeApp(f);
    const res = await app.request(PATH, {
      headers: await boundHeaders(sniper),
    });
    expect(res.status).toBe(403);
    expect(f.peekPayer).toHaveBeenCalledTimes(1);
    expect(f.verify).not.toHaveBeenCalled(); // dedup slot intact
  });

  it("post-verify payer compare: no peekPayer → 403 after verify", async () => {
    const f = makeFacilitator(false);
    f.verify.mockResolvedValue({ valid: true, payer: payer.address });
    const { app, handler } = makeApp(f);
    // Sniper validly binds THEIR wallet to the victim txHash.
    const res = await app.request(PATH, {
      headers: await boundHeaders(sniper),
    });
    expect(res.status).toBe(403);
    expect(handler).not.toHaveBeenCalled();
  });

  it("free tier unchanged: no payment → pass, over-limit 402 w/ declaration", async () => {
    const f = makeFacilitator();
    const { app, handler } = makeApp(f);
    const first = await app.request(PATH, { headers: { "x-wallet": payer.address } });
    expect(first.status).toBe(200);
    expect(handler).toHaveBeenCalledTimes(1);
    const second = await app.request(PATH, { headers: { "x-wallet": payer.address } });
    expect(second.status).toBe(402);
    const body = await second.json();
    expect(body.payerBinding.required).toBe(true);
    expect(body.accepts.extra.payerBinding.challenge).toBe("agentbadge-pay:v1");
    expect(f.verify).not.toHaveBeenCalled();
  });

  it("gate off → payment w/o binding headers reaches verify (legacy)", async () => {
    vi.stubEnv("PAYER_BIND_ENABLED", "");
    const f = makeFacilitator();
    const { app, handler } = makeApp(f);
    const res = await app.request(PATH, {
      headers: { "payment-signature": paymentHeader() },
    });
    expect(res.status).toBe(200);
    expect(f.verify).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
