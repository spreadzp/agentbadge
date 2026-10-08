/**
 * SLICE-171-5: e2e snipe-test through the REAL stack —
 * payerBinding middleware → requirePayment → createPaymentRouter →
 * real createArcSelfSettleHandle (claim-free inspect + txHashStore).
 *
 * Steps (per slice AC):
 *  1) attacker: victim's txHash + attacker's X-Sig → 403, slot NOT
 *     consumed (seenTxHashes untouched);
 *  2) legit: victim's txHash + victim's X-Sig → 200 — proof the slot
 *     survived the attack;
 *  3) retry of the same txHash → 402 replay — proof the claim
 *     mechanism itself works end-to-end.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Hono, type MiddlewareHandler } from "hono";
import { privateKeyToAccount } from "viem/accounts";
import { verifyMessage } from "viem";
import {
  ARC_TESTNET,
  buildPayerChallenge,
  createArcSelfSettleHandle,
  createPaymentRouter,
  requirePayment,
} from "@agentbadge/circle-payments";
import {
  configurePayerBindingForTesting,
  resetPayerBindingForTesting,
} from "../src/server/middleware/payer-binding";
import { wireKeeperhubX402 } from "../src/server/wiring/keeperhub-x402";
import { resetConfigCache } from "../src/config/env";
import { resetCacheForTests } from "../src/server/lib/cache";
import type { CirclePaymentsRuntime } from "../src/server/lib/circle-payments";

const VICTIM_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;
const ATTACKER_KEY =
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as const;
const victim = privateKeyToAccount(VICTIM_KEY);
const attacker = privateKeyToAccount(ATTACKER_KEY);

const TX_HASH =
  "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";
const PAY_TO = "0x8888888888888888888888888888888888888888";
const PATH = "/api/keeperhub/scan/premium";
const TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

const padTopic = (addr: string) =>
  `0x${addr.slice(2).toLowerCase().padStart(64, "0")}`;

/** Receipt fixture: USDC Transfer victim → PAY_TO, value ≥ $0.01. */
const receiptFixture = {
  status: "success",
  transactionHash: TX_HASH,
  logs: [
    {
      address: ARC_TESTNET.usdc,
      topics: [TRANSFER_TOPIC, padTopic(victim.address), padTopic(PAY_TO)],
      data: `0x${BigInt(10000).toString(16)}`,
    },
  ],
};

const paymentHeader = (txHash = TX_HASH) =>
  Buffer.from(
    JSON.stringify({
      x402Version: 2,
      accepted: {
        scheme: "eip3009-client-broadcast",
        network: ARC_TESTNET.caip2,
        asset: ARC_TESTNET.usdc,
      },
      payload: { txHash },
    }),
  ).toString("base64");

async function boundHeaders(account: typeof victim) {
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = await account.signMessage({
    message: buildPayerChallenge({
      wallet: account.address,
      method: "POST",
      path: PATH,
      payRef: TX_HASH,
      timestamp,
    }),
  });
  return {
    "payment-signature": paymentHeader(),
    "x-wallet": account.address,
    "x-sig": signature,
    "x-timestamp": String(timestamp),
  };
}

function buildApp() {
  const handle = createArcSelfSettleHandle({
    sellerAddress: PAY_TO,
    publicClient: {
      getTransactionReceipt: async () => receiptFixture,
    },
  });
  const router = createPaymentRouter({
    sellerAddress: PAY_TO,
    gateway: false,
    exact: false,
    arc: true,
    handles: { arcSelfSettle: handle },
  });
  const runtime = {
    arcSelfSettle: handle,
    paymentForPrice: (price: string, opts?: Record<string, unknown>) =>
      requirePayment(price, { ...opts, router } as never) as MiddlewareHandler,
  } as unknown as CirclePaymentsRuntime;
  const app = new Hono();
  wireKeeperhubX402(app, { runtime });
  app.post(PATH, (c) => c.json({ ok: true }));
  return { app, handle };
}

describe("SLICE-171-5: e2e snipe-test (real arc-self-settle stack)", () => {
  beforeEach(() => {
    vi.stubEnv("PAYER_BIND_ENABLED", "true");
    vi.stubEnv("CACHE_ENABLED", "false");
    vi.stubEnv("KEEPERHUB_ENABLED", "true");
    vi.stubEnv("KEEPERHUB_X402_ENABLED", "true");
    vi.stubEnv("X402_PAY_TO", PAY_TO);
    resetConfigCache();
    resetCacheForTests();
    configurePayerBindingForTesting({
      verifier: (wallet, message, signature) =>
        verifyMessage({
          address: wallet as `0x${string}`,
          message,
          signature: signature as `0x${string}`,
        }),
    });
  });
  afterEach(() => {
    resetPayerBindingForTesting();
    vi.unstubAllEnvs();
    resetConfigCache();
    resetCacheForTests();
  });

  it("attacker 403 → legit 200 → retry 402 replay (slot lifecycle intact)", async () => {
    const { app, handle } = buildApp();

    // 1) attacker: victim's txHash + attacker's own valid signature →
    //    rejected at the binding peek — verify/slot-claim never reached.
    const sniped = await app.request(PATH, {
      method: "POST",
      headers: await boundHeaders(attacker),
    });
    expect(sniped.status).toBe(403);
    expect(handle.seenTxHashes.has(TX_HASH.toLowerCase())).toBe(false);

    // 2) legit payer binds their own txHash → 200. This is the AC's
    //    "slot intact" proof — a burned slot would have made this a
    //    replay-402.
    const legit = await app.request(PATH, {
      method: "POST",
      headers: await boundHeaders(victim),
    });
    expect(legit.status).toBe(200);
    expect(handle.seenTxHashes.has(TX_HASH.toLowerCase())).toBe(true);

    // 3) retry of the now-consumed txHash → real replay rejection,
    //    proving the claim actually ran end-to-end.
    const replay = await app.request(PATH, {
      method: "POST",
      headers: await boundHeaders(victim),
    });
    expect(replay.status).toBe(402);
    const body = await replay.json();
    expect(String(body.error)).toMatch(/replay|Payment/i);
  });
});
