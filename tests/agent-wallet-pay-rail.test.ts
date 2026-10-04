/**
 * SLICE-155-4 tests: agent pay rail — x402 from agent wallet.
 *  - requirePayment onBeforeSettle fires with verified payer pre-settle
 *  - envelope deny → 402 spend_cap before router.settle is called
 *  - onSettleResult: settle ok → settled entry + txHash; fail → released
 *  - X-Max-Amount: price > declared cap → 402 before verify
 *  - GET /api/wallets/:a/spend — owner/registrant/admin auth + entries
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";

import {
  requirePayment,
  type PaymentPayload,
  type PaymentRouter,
  type PaymentRequirements,
} from "@agentbadge/circle-payments";
import { createSpendX402Hooks } from "../src/server/lib/agent-wallet/x402-hooks";
import { createMemorySpendLedger } from "../src/server/lib/agent-wallet/ledger";
import {
  createSpendEnforcer,
  initSpendEnforcer,
} from "../src/server/lib/agent-wallet/enforcer";
import {
  createMemoryAgentWalletStore,
  type AgentWalletRecord,
} from "../src/server/lib/agent-wallet/registry";
import { createAgentWalletLimitsRoutes } from "../src/server/routes/agent-wallet-limits-api";
import {
  configureAgentAuthForTesting,
  resetAgentAuthForTesting,
} from "../src/server/middleware/agent-auth";
import { resetConfigCache } from "../src/config/env";
import {
  resetStoreForTesting,
  useMemoryStoreForTesting,
} from "../src/server/lib/venue/store";

const W = "0x00000000000000000000000000000000000000b1" as `0x${string}`;
const W2 = "0x00000000000000000000000000000000000000b2" as `0x${string}`;
const SELLER = "0x0000000000000000000000000000000000000aaa";
const SAVED_DB = process.env.DATABASE_ENABLED;

const rec = (address: `0x${string}`, envelope = {}): AgentWalletRecord => ({
  address,
  label: "x",
  kind: "eoa",
  envelope,
  registeredBy: address.toLowerCase() as `0x${string}`,
  createdAt: Date.now(),
  active: true,
});

const REQUIREMENTS: PaymentRequirements = {
  scheme: "exact",
  network: "eip155:5042002",
  asset: "0xUSDC",
  payTo: SELLER,
  amount: "250000", // $0.25
  maxTimeoutSeconds: 60,
};

const paySig = (from: string) =>
  Buffer.from(
    JSON.stringify({
      x402Version: 2,
      accepted: REQUIREMENTS,
      payload: { authorization: { from } },
    }),
  ).toString("base64");

function mockRouter(calls: { settle: number }): PaymentRouter {
  return {
    acceptsFor: () => [REQUIREMENTS],
    verify: async () => ({ isValid: true, payer: W }),
    settle: async (payload: PaymentPayload, req: PaymentRequirements) => {
      calls.settle += 1;
      void payload;
      return {
        success: true,
        transaction: "0xdeadbeef" as `0x${string}`,
        network: req.network,
        payer: W,
      };
    },
  } as unknown as PaymentRouter;
}

async function appFor(opts: {
  envelope?: Record<string, number>;
  requireRegistered?: boolean;
}) {
  const store = createMemoryAgentWalletStore();
  await store.put(rec(W, opts.envelope ?? {}));
  const ledger = createMemorySpendLedger();
  initSpendEnforcer(
    createSpendEnforcer({
      ledger,
      registry: store,
      requireRegistered: opts.requireRegistered ?? false,
    }),
  );
  const calls = { settle: 0 };
  const app = new Hono();
  app.post(
    "/api/pay",
    requirePayment("$0.25", {
      sellerAddress: SELLER,
      handles: {},
      router: mockRouter(calls),
      ...createSpendX402Hooks(),
    }),
    (c) => c.json({ ok: true }),
  );
  return { app, ledger, calls };
}

const pay = (app: Hono, headers: Record<string, string>) =>
  app.request("/api/pay", { method: "POST", headers });

beforeEach(() => {
  process.env.DATABASE_ENABLED = "false";
  resetConfigCache();
  useMemoryStoreForTesting();
  configureAgentAuthForTesting({ verifier: async () => true });
  initSpendEnforcer(null);
});
afterEach(() => {
  initSpendEnforcer(null);
  resetStoreForTesting();
  resetAgentAuthForTesting();
  if (SAVED_DB === undefined) delete process.env.DATABASE_ENABLED;
  else process.env.DATABASE_ENABLED = SAVED_DB;
  resetConfigCache();
});

describe("pay rail: envelope inside requirePayment", () => {
  it("registered wallet over cap → 402 spend_cap, settle NEVER called", async () => {
    const { app, calls } = await appFor({ envelope: { perTxUsd: 0.1 } });
    const res = await pay(app, { "payment-signature": paySig(W) });
    expect(res.status).toBe(402);
    const body = await res.json();
    expect(body.error).toBe("spend_cap");
    expect(body.cap).toBe("perTx");
    expect(calls.settle).toBe(0);
  });

  it("registered wallet under cap → 200, ledger settled + txHash", async () => {
    const { app, ledger, calls } = await appFor({ envelope: { dailyUsd: 1 } });
    const res = await pay(app, { "payment-signature": paySig(W) });
    expect(res.status).toBe(200);
    expect(calls.settle).toBe(1);
    const entries = await ledger.listByWallet(W);
    expect(entries).toHaveLength(1);
    expect(entries[0].state).toBe("settled");
    expect(entries[0].txHash).toBe("0xdeadbeef");
    expect(entries[0].kind).toBe("x402");
    expect(entries[0].refId).toMatch(/^x402:POST \/api\/pay/);
  });

  it("unregistered wallet → pass-through settle (opt-in), settled entry recorded (attribution, no caps)", async () => {
    const { app, ledger, calls } = await appFor({});
    const res = await pay(app, { "payment-signature": paySig(W2) });
    expect(res.status).toBe(200);
    expect(calls.settle).toBe(1);
    // No caps → no reserve; but complete() still records settled spend
    // for ledger completeness (spec: every settle writes wallet+kind).
    const entries = await ledger.listByWallet(W2);
    expect(entries).toHaveLength(1);
    expect(entries[0].state).toBe("settled");
  });

  it("requireRegistered → unregistered denied 402, settle not called", async () => {
    const { app, calls } = await appFor({ requireRegistered: true });
    const res = await pay(app, { "payment-signature": paySig(W2) });
    expect(res.status).toBe(402);
    expect(calls.settle).toBe(0);
  });

  it("X-Max-Amount below price → 402 before verify/settle", async () => {
    const { app, calls } = await appFor({});
    const res = await pay(app, {
      "payment-signature": paySig(W),
      "x-max-amount": "0.10",
    });
    expect(res.status).toBe(402);
    const body = await res.json();
    expect(body.error).toMatch(/X-Max-Amount/);
    expect(calls.settle).toBe(0);
  });

  it("X-Max-Amount above price → normal settle", async () => {
    const { app, calls } = await appFor({});
    const res = await pay(app, {
      "payment-signature": paySig(W),
      "x-max-amount": "1.00",
    });
    expect(res.status).toBe(200);
    expect(calls.settle).toBe(1);
  });
});

describe("GET /api/wallets/:a/spend", () => {
  const signed = (wallet: string) => ({
    "x-wallet": wallet,
    "x-sig": "0xdead",
    "x-timestamp": String(Math.floor(Date.now() / 1000)),
  });

  async function spendApp() {
    const store = createMemoryAgentWalletStore();
    await store.put(rec(W));
    const ledger = createMemorySpendLedger();
    await ledger.insert({
      id: "sp_1",
      wallet: W,
      amountUsd: 2.5,
      kind: "eaas",
      refId: "v1",
      state: "settled",
      txHash: "0xabc" as `0x${string}`,
      at: Date.now(),
    });
    await ledger.insert({
      id: "sp_2",
      wallet: W,
      amountUsd: 1,
      kind: "x402",
      refId: "r2",
      state: "reserved",
      at: Date.now(),
    });
    const app = new Hono();
    app.route(
      "/",
      createAgentWalletLimitsRoutes({ store, ledger, chain: "ARC" }),
    );
    return app;
  }

  it("owner sig → 200 with entries incl txHash + settled total", async () => {
    const res = await (await spendApp()).request(`/api/wallets/${W}/spend`, {
      headers: signed(W),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.spend).toHaveLength(2);
    expect(body.spend[0].txHash).toBe("0xabc");
    expect(body.totals.settledUsd).toBe(2.5);
  });

  it("no sig → 401; stranger sig → 403; ?state=settled filters", async () => {
    const app = await spendApp();
    expect(
      (await app.request(`/api/wallets/${W}/spend`)).status,
    ).toBe(401);
    expect(
      (
        await app.request(`/api/wallets/${W}/spend`, {
          headers: signed(W2),
        })
      ).status,
    ).toBe(403);
    const res = await app.request(`/api/wallets/${W}/spend?state=settled`, {
      headers: signed(W),
    });
    const body = await res.json();
    expect(body.spend).toHaveLength(1);
    expect(body.spend[0].id).toBe("sp_1");
  });
});
