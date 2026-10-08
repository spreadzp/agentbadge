/**
 * SLICE-171-2: payer-binding middleware tests (EPIC-171).
 *
 * Covers:
 * - PAYER_BIND_ENABLED gate (off → full passthrough)
 * - no PAYMENT-SIGNATURE → passthrough + payerBindRequired flag
 * - payment present + missing binding headers → 402 payerBinding decl
 * - valid (wallet, sig, payRef) → pass, wallet in ctx
 * - sig from a different key → 403 before verify (slot not consumed)
 * - stale timestamp → 403
 * - X-Wallet ≠ on-chain payer (resolvePayer) → 403 before verify
 * - txHash case normalization in challenge + dedup
 * - e2e ordering: foreign txHash without valid binding → 403/402 and
 *   facilitator.verify NOT called; legit retry of same txHash passes
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Hono } from "hono";
import { privateKeyToAccount } from "viem/accounts";
import { verifyMessage } from "viem";
import { buildPayerChallenge } from "@agentbadge/circle-payments";
import {
  payerBinding,
  configurePayerBindingForTesting,
  resetPayerBindingForTesting,
  PAYER_BINDING_DECLARATION,
  type PayerBindVariables,
} from "../src/server/middleware/payer-binding";

// Hardhat account #0/#1 — well-known test keys, never hold real funds.
const PAYER_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;
const SNIPER_KEY =
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as const;
const payer = privateKeyToAccount(PAYER_KEY);
const sniper = privateKeyToAccount(SNIPER_KEY);

const PATH = "/api/paid-thing";
const TX_HASH =
  "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

const nowSec = () => Math.floor(Date.now() / 1000);

function paymentHeader(txHash = TX_HASH) {
  return Buffer.from(
    JSON.stringify({ payload: { txHash } }),
  ).toString("base64");
}

async function signFor(
  account: typeof payer,
  opts: {
    method?: string;
    path?: string;
    payRef?: string;
    timestamp?: number;
    wallet?: string;
  } = {},
) {
  const timestamp = opts.timestamp ?? nowSec();
  const wallet = opts.wallet ?? account.address;
  const signature = await account.signMessage({
    message: buildPayerChallenge({
      wallet,
      method: opts.method ?? "GET",
      path: opts.path ?? PATH,
      payRef: opts.payRef ?? TX_HASH,
      timestamp,
    }),
  });
  return { signature, timestamp, wallet };
}

function makeApp(opts: Parameters<typeof payerBinding>[0] = {}) {
  const handler = vi.fn((c) =>
    c.json({ ok: true, wallet: c.get("payerBindWallet") }),
  );
  const app = new Hono<{ Variables: PayerBindVariables }>();
  app.get(PATH, payerBinding(opts), handler);
  return { app, handler };
}

const localVerifier = (
  wallet: string,
  message: string,
  signature: string,
) =>
  verifyMessage({
    address: wallet as `0x${string}`,
    message,
    signature: signature as `0x${string}`,
  });

describe("SLICE-171-2: payer-binding middleware", () => {
  beforeEach(() => {
    configurePayerBindingForTesting({ verifier: localVerifier });
    vi.stubEnv("PAYER_BIND_ENABLED", "true");
  });
  afterEach(() => {
    resetPayerBindingForTesting();
    vi.unstubAllEnvs();
  });

  it("gate off → full passthrough (rollback)", async () => {
    vi.stubEnv("PAYER_BIND_ENABLED", "");
    const { app, handler } = makeApp();
    const res = await app.request(PATH, {
      headers: { "payment-signature": paymentHeader() },
    });
    expect(res.status).toBe(200);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("no PAYMENT-SIGNATURE → passthrough, payerBindRequired set", async () => {
    const { app, handler } = makeApp();
    const res = await app.request(PATH);
    expect(res.status).toBe(200);
    expect(handler).toHaveBeenCalledTimes(1);
    // No binding headers — wallet not bound.
    expect((await res.json()).wallet).toBeUndefined();
  });

  it("payment present but binding headers missing → 402 declaration", async () => {
    const { app, handler } = makeApp();
    const res = await app.request(PATH, {
      headers: { "payment-signature": paymentHeader() },
    });
    expect(res.status).toBe(402);
    const body = await res.json();
    expect(body.payerBinding).toEqual(PAYER_BINDING_DECLARATION);
    const encoded = res.headers.get("PAYMENT-REQUIRED");
    expect(encoded).toBeTruthy();
    const decoded = JSON.parse(
      Buffer.from(encoded!, "base64").toString("utf-8"),
    );
    expect(decoded.payerBinding.required).toBe(true);
    expect(decoded.payerBinding.challenge).toBe("agentbadge-pay:v1");
    // Ordering AC: downstream (verify) never reached.
    expect(handler).not.toHaveBeenCalled();
  });

  it("valid (wallet, sig, payRef) → pass + payerBindWallet in ctx", async () => {
    const { app, handler } = makeApp();
    const { signature, timestamp } = await signFor(payer);
    const res = await app.request(PATH, {
      headers: {
        "payment-signature": paymentHeader(),
        "x-wallet": payer.address,
        "x-sig": signature,
        "x-timestamp": String(timestamp),
      },
    });
    expect(res.status).toBe(200);
    expect(handler).toHaveBeenCalledTimes(1);
    expect((await res.json()).wallet).toBe(payer.address.toLowerCase());
  });

  it("sig from a different key → 403, handler not reached", async () => {
    const { app, handler } = makeApp();
    // Sniper signs a challenge binding THEIR key to the victim txHash —
    // cryptographically valid but wallet==sniper; then presents it with
    // x-wallet=payer → signature no longer verifies → 403.
    const { signature, timestamp } = await signFor(sniper, {
      wallet: sniper.address,
    });
    const res = await app.request(PATH, {
      headers: {
        "payment-signature": paymentHeader(),
        "x-wallet": payer.address, // claiming the victim's wallet
        "x-sig": signature,
        "x-timestamp": String(timestamp),
      },
    });
    expect(res.status).toBe(403);
    expect(handler).not.toHaveBeenCalled();
  });

  it("stale timestamp → 403", async () => {
    const { app, handler } = makeApp();
    const stale = nowSec() - 301;
    const { signature } = await signFor(payer, { timestamp: stale });
    const res = await app.request(PATH, {
      headers: {
        "payment-signature": paymentHeader(),
        "x-wallet": payer.address,
        "x-sig": signature,
        "x-timestamp": String(stale),
      },
    });
    expect(res.status).toBe(403);
    expect(handler).not.toHaveBeenCalled();
  });

  it("resolvePayer mismatch → 403 before downstream verify", async () => {
    const resolvePayer = vi.fn().mockResolvedValue(payer.address);
    const { app, handler } = makeApp({ resolvePayer });
    // Sniper signs validly with their OWN wallet over the victim tx —
    // sig verifies, but on-chain payer is the victim → 403 pre-verify.
    const { signature, timestamp } = await signFor(sniper);
    const res = await app.request(PATH, {
      headers: {
        "payment-signature": paymentHeader(),
        "x-wallet": sniper.address,
        "x-sig": signature,
        "x-timestamp": String(timestamp),
      },
    });
    expect(res.status).toBe(403);
    expect(resolvePayer).toHaveBeenCalledTimes(1);
    expect(handler).not.toHaveBeenCalled();
  });

  it("resolvePayer match → pass", async () => {
    const resolvePayer = vi
      .fn()
      .mockResolvedValue(payer.address.toLowerCase());
    const { app, handler } = makeApp({ resolvePayer });
    const { signature, timestamp } = await signFor(payer);
    const res = await app.request(PATH, {
      headers: {
        "payment-signature": paymentHeader(),
        "x-wallet": payer.address,
        "x-sig": signature,
        "x-timestamp": String(timestamp),
      },
    });
    expect(res.status).toBe(200);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("txHash case: challenge uses lower-cased payRef (mixed-case header ok)", async () => {
    const { app } = makeApp();
    const mixed = `0x${TX_HASH.slice(2).toUpperCase()}`;
    // Sign the lower-cased payRef; present a mixed-case txHash.
    const { signature, timestamp } = await signFor(payer, {
      payRef: TX_HASH.toLowerCase(),
    });
    const res = await app.request(PATH, {
      headers: {
        "payment-signature": paymentHeader(mixed),
        "x-wallet": payer.address,
        "x-sig": signature,
        "x-timestamp": String(timestamp),
      },
    });
    expect(res.status).toBe(200);
  });

  it("signature result cached — verifier hit once per challenge", async () => {
    const spy = vi.fn(localVerifier);
    configurePayerBindingForTesting({ verifier: spy });
    const { app } = makeApp();
    const { signature, timestamp } = await signFor(payer);
    const headers = {
      "payment-signature": paymentHeader(),
      "x-wallet": payer.address,
      "x-sig": signature,
      "x-timestamp": String(timestamp),
    };
    await app.request(PATH, { headers });
    await app.request(PATH, { headers });
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe("SLICE-171-2: snipe fixture (dedup slot not burned)", () => {
  const claimed = new Set<string>();

  function makeSnipeApp() {
    // A minimal "facilitator" that burns the dedup slot on verify —
    // mirrors arc-self-settle handle semantics.
    const verify = vi.fn(async (header: string) => {
      const p = JSON.parse(
        Buffer.from(header, "base64").toString("utf-8"),
      ) as { payload: { txHash: string } };
      const key = p.payload.txHash.toLowerCase();
      if (claimed.has(key)) return { valid: false, error: "tx_replayed" };
      claimed.add(key);
      return { valid: true };
    });
    const resolvePayer = vi.fn().mockResolvedValue(payer.address);
    const app = new Hono<{ Variables: PayerBindVariables }>();
    app.get(PATH, payerBinding({ resolvePayer }), async (c) => {
      const v = await verify(c.req.header("payment-signature")!);
      if (!v.valid) return c.json({ error: v.error }, 409);
      return c.json({ ok: true });
    });
    return { app, verify };
  }

  beforeEach(() => {
    claimed.clear();
    configurePayerBindingForTesting({ verifier: localVerifier });
    vi.stubEnv("PAYER_BIND_ENABLED", "true");
  });
  afterEach(() => {
    resetPayerBindingForTesting();
    vi.unstubAllEnvs();
  });

  it("foreign txHash w/o valid binding → rejected, slot NOT burned, legit retry passes", async () => {
    const { app, verify } = makeSnipeApp();

    // 1. Sniper: foreign txHash, no binding headers at all.
    const snipe1 = await app.request(PATH, {
      headers: { "payment-signature": paymentHeader() },
    });
    expect(snipe1.status).toBe(402);

    // 2. Sniper: foreign txHash + sig from own key (valid crypto, but
    //    on-chain payer is the victim) → 403 via resolvePayer.
    const { signature, timestamp } = await signFor(sniper);
    const snipe2 = await app.request(PATH, {
      headers: {
        "payment-signature": paymentHeader(),
        "x-wallet": sniper.address,
        "x-sig": signature,
        "x-timestamp": String(timestamp),
      },
    });
    expect(snipe2.status).toBe(403);

    // Dedup slot untouched — verify was never reached.
    expect(verify).not.toHaveBeenCalled();
    expect(claimed.size).toBe(0);

    // 3. Legit buyer retries with proper binding → verify consumes the
    //    slot exactly once and the request passes.
    const legit = await signFor(payer);
    const ok = await app.request(PATH, {
      headers: {
        "payment-signature": paymentHeader(),
        "x-wallet": payer.address,
        "x-sig": legit.signature,
        "x-timestamp": String(legit.timestamp),
      },
    });
    expect(ok.status).toBe(200);
    expect(verify).toHaveBeenCalledTimes(1);
    expect(claimed.has(TX_HASH.toLowerCase())).toBe(true);
  });
});
