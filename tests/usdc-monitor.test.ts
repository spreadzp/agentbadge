/**
 * USDC payment monitor tests (EPIC-222-3, MYPROJ-2793).
 *
 * Full mock-RPC lifecycle: payable attempt → Transfer scan →
 * match/verify (222-1) → confirmPayment evidence seam → CONFIRMED
 * with receipt + events + fulfillment dispatch. Plus spec
 * invariants (wrong-network/amount never confirms), RPC-down retry,
 * env gate, and fulfillment effect-dedupe (reviews 6.1/6.2).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import {
  ARC_TESTNET_CAIP2,
  createInMemoryPaymentStores,
  getPaymentNetwork,
  PaymentProviderRegistry,
  PaymentService,
  type ArcChainClient,
  type ChainTxEvidence,
  type DecodedTransfer,
  type PaymentServiceStores,
} from "@agentbadge/payments";

import { runUsdcMonitorTick } from "../src/server/lib/payments-api/usdc-monitor";
import {
  dispatchFulfillment,
  resetFulfillmentRegistry,
  type FulfillmentEffectContext,
  type FulfillmentEventStore,
  type FulfillmentHandler,
} from "../src/server/lib/payments-api/fulfillment";
import { DirectUsdcStubProvider } from "../src/server/lib/payments-api/usdc-provider";
import { loadPayments } from "../src/config/env/payments";

const CAIP2 = ARC_TESTNET_CAIP2;
const NET = getPaymentNetwork(CAIP2)!;
const TOKEN = NET.assets.find((a) => a.symbol === "USDC")!.contractAddress;
const TREASURY = "0x1111111111111111111111111111111111111111";
const PAYER = "0x2222222222222222222222222222222222222222";
const TX_HASH = "0x" + "ab".repeat(32);
const TX_BLOCK = 4990n;
const HEAD = 5000n;
const CONFIRMS = Number(HEAD - TX_BLOCK + 1n);
const BLOCK_TS = 1_800_000_000;
const NOW_MS = BLOCK_TS * 1000 + 30_000;
const CLAIM_STALE_MS = 10 * 60 * 1000;

const USDC_NETWORKS = {
  [CAIP2]: { recipient: TREASURY, tokenContract: TOKEN, label: "arc" },
};

type Stores = ReturnType<typeof createInMemoryPaymentStores>;

function mockChain(transfers: DecodedTransfer[], fail?: Error): ArcChainClient {
  return {
    network: NET,
    getHead: async () => HEAD,
    scanTransfers: async () => {
      if (fail) throw fail;
      return transfers;
    },
    getTxReceipt: async (h) => ({
      transactionHash: h,
      blockNumber: TX_BLOCK,
      status: "success",
    }),
    getConfirmations: async () => ({
      confirmations: CONFIRMS,
      finalized: true,
    }),
    getBlockTimestamp: async () => BLOCK_TS,
    verifyChainId: async () => { },
    txEvidence: async (tx) => ({
      ...tx,
      network: CAIP2,
      confirmations: CONFIRMS,
      blockTimestampSec: BLOCK_TS,
    }),
  };
}

function transfer(amountUnits: bigint, txHash = TX_HASH): DecodedTransfer {
  return {
    txHash,
    logIndex: 0,
    from: PAYER,
    to: TREASURY,
    amountUnits,
    blockNumber: TX_BLOCK,
  };
}

async function seedPayment(
  stores: Stores,
  opts: { attemptStatus?: string; amount?: string; paymentId?: string } = {},
) {
  const paymentId = opts.paymentId ?? "pay1";
  const amount = opts.amount ?? "9.990044";
  await stores.payments.create({
    id: paymentId,
    reference: `ref-${paymentId}`,
    amount,
    currency: "USD",
    status: "PROCESSING",
    purpose: "ORDER",
    createdAtMs: NOW_MS,
    updatedAtMs: NOW_MS,
    payload: { productCode: "PASSPORT_BRONZE" },
  });
  await stores.attempts.create({
    id: `att-${paymentId}`,
    paymentId,
    provider: "DIRECT_USDC",
    network: CAIP2,
    token: TOKEN,
    amount,
    currency: "USDC",
    status: opts.attemptStatus ?? "PENDING",
    providerReference: `usdc_${CAIP2}_${paymentId}`,
    expiresAtMs: NOW_MS + 3_600_000,
    payload: {
      expectedRecipient: TREASURY,
      expectedAmount: amount,
      network: CAIP2,
      minConfirmations: 1,
    },
  });
  return paymentId;
}

function makeDeps(
  stores: Stores,
  chain: ArcChainClient,
  fulfill?: (paymentId: string) => Promise<void>,
) {
  const registry = new PaymentProviderRegistry();
  registry.register(new DirectUsdcStubProvider({ networks: USDC_NETWORKS }));
  const service = new PaymentService({
    stores: stores as unknown as PaymentServiceStores,
    providers: registry,
    now: () => new Date(NOW_MS),
  });
  return {
    stores: stores as unknown as PaymentServiceStores,
    confirm: service.confirmPayment.bind(service),
    fulfill,
    chainFor: (caip2: string) => (caip2 === CAIP2 ? chain : undefined),
    treasuryFor: (caip2: string) => (caip2 === CAIP2 ? TREASURY : undefined),
    lookbackBlocks: 4096n,
    nowMs: () => NOW_MS,
  };
}

describe("runUsdcMonitorTick", () => {
  let stores: Stores;

  beforeEach(() => {
    stores = createInMemoryPaymentStores();
  });

  it("full lifecycle: payable attempt + exact Transfer → CONFIRMED + receipt + events + fulfillment", async () => {
    await seedPayment(stores);
    const fulfill = vi.fn(async () => { });
    const result = await runUsdcMonitorTick(
      makeDeps(stores, mockChain([transfer(9_990_044n)]), fulfill),
    );

    expect(result.confirmed).toBe(1);
    expect(result.errors).toEqual([]);
    const attempt = await stores.attempts.getById("att-pay1");
    expect(attempt?.status).toBe("CONFIRMED");
    expect(attempt?.transactionHash).toBe(TX_HASH);
    expect(attempt?.confirmedAtMs).toBe(NOW_MS);
    const payment = await stores.payments.getById("pay1");
    expect(payment?.status).toBe("CONFIRMED");
    const receipts = await stores.receipts.listByPayment("pay1");
    expect(receipts).toHaveLength(1);
    expect(receipts[0].transactionHash).toBe(TX_HASH);
    const events = await stores.events.listByPayment("pay1");
    expect(
      events.some(
        (e) => e.entity === "PAYMENT_ATTEMPT" && e.to === "CONFIRMED",
      ),
    ).toBe(true);
    expect(fulfill).toHaveBeenCalledWith("pay1");
  });

  it("idempotent: second tick on a CONFIRMED attempt does nothing", async () => {
    await seedPayment(stores);
    const fulfill = vi.fn(async () => { });
    const deps = makeDeps(stores, mockChain([transfer(9_990_044n)]), fulfill);
    await runUsdcMonitorTick(deps);
    const second = await runUsdcMonitorTick(deps);
    expect(second.payableAttempts).toBe(0);
    expect(second.confirmed).toBe(0);
    expect(fulfill).toHaveBeenCalledTimes(1);
  });

  it("wrong amount → FUZZY flag only, attempt stays payable, never CONFIRMED", async () => {
    await seedPayment(stores);
    const fulfill = vi.fn(async () => { });
    const result = await runUsdcMonitorTick(
      makeDeps(stores, mockChain([transfer(9_990_045n)]), fulfill),
    );

    expect(result.confirmed).toBe(0);
    expect(result.flagged).toBe(1);
    const attempt = await stores.attempts.getById("att-pay1");
    expect(attempt?.status).toBe("PENDING");
    const events = await stores.events.listByPayment("pay1");
    const flag = events.find(
      (e) => e.actor === "usdc-monitor" && e.from === e.to,
    );
    expect(flag).toBeDefined();
    expect(flag?.reason).toContain("OVERPAID");
    expect(flag?.reason).toContain(TX_HASH);
    expect(fulfill).not.toHaveBeenCalled();
  });

  it("foreign-network evidence → no match, no confirm", async () => {
    await seedPayment(stores);
    const chain = mockChain([transfer(9_990_044n)]);
    chain.txEvidence = async (tx): Promise<ChainTxEvidence> => ({
      ...tx,
      network: "eip155:8453",
      confirmations: CONFIRMS,
      blockTimestampSec: BLOCK_TS,
    });
    const result = await runUsdcMonitorTick(makeDeps(stores, chain));
    expect(result.confirmed).toBe(0);
    const attempt = await stores.attempts.getById("att-pay1");
    expect(attempt?.status).toBe("PENDING");
  });

  it("RPC down → errors collected, attempts stay payable, next tick confirms", async () => {
    await seedPayment(stores);
    const down = await runUsdcMonitorTick(
      makeDeps(stores, mockChain([transfer(9_990_044n)], new Error("rpc down"))),
    );
    expect(down.confirmed).toBe(0);
    expect(down.errors[0].stage).toContain("network:");
    expect((await stores.attempts.getById("att-pay1"))?.status).toBe("PENDING");

    const up = await runUsdcMonitorTick(
      makeDeps(stores, mockChain([transfer(9_990_044n)])),
    );
    expect(up.confirmed).toBe(1);
    expect((await stores.attempts.getById("att-pay1"))?.status).toBe("CONFIRMED");
  });

  it("insufficient finality → PROCESSING + txHash bound, then CONFIRMED", async () => {
    await seedPayment(stores);
    const short = mockChain([transfer(9_990_044n)]);
    short.getConfirmations = async () => ({
      confirmations: 0,
      finalized: false,
    });
    short.txEvidence = async (tx) => ({
      ...tx,
      network: CAIP2,
      confirmations: 0,
      blockTimestampSec: BLOCK_TS,
    });
    const first = await runUsdcMonitorTick(makeDeps(stores, short));
    expect(first.confirmed).toBe(0);
    expect(first.pending).toBe(1);
    const mid = await stores.attempts.getById("att-pay1");
    expect(mid?.status).toBe("PROCESSING");
    expect(mid?.transactionHash).toBe(TX_HASH);

    const second = await runUsdcMonitorTick(
      makeDeps(stores, mockChain([transfer(9_990_044n)])),
    );
    expect(second.confirmed).toBe(1);
  });

  it("no payable attempts → empty tick", async () => {
    const result = await runUsdcMonitorTick(makeDeps(stores, mockChain([])));
    expect(result.payableAttempts).toBe(0);
    expect(result.confirmed).toBe(0);
  });
});

describe("usdc monitor env gate (USDC_MONITOR_ENABLED + ARC_RPC_URL)", () => {
  const ENV_KEYS = [
    "USDC_MONITOR_ENABLED",
    "ARC_RPC_URL",
    "EVM_CHAIN_ID",
    "ARC_USDC_TREASURY",
    "EVM_USDC_ADDRESS",
  ];
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });
  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("disabled without USDC_MONITOR_ENABLED=true even when RPC+network configured", () => {
    process.env.EVM_CHAIN_ID = "5042002";
    process.env.ARC_USDC_TREASURY = TREASURY;
    process.env.EVM_USDC_ADDRESS = TOKEN;
    process.env.ARC_RPC_URL = "http://localhost:8545";
    const errors: string[] = [];
    const cfg = loadPayments(errors);
    expect(cfg.usdcMonitor.enabled).toBe(false);
    expect(errors).toEqual([]);
  });

  it("disabled when enabled flag set but ARC_RPC_URL missing", () => {
    process.env.USDC_MONITOR_ENABLED = "true";
    process.env.EVM_CHAIN_ID = "5042002";
    process.env.ARC_USDC_TREASURY = TREASURY;
    process.env.EVM_USDC_ADDRESS = TOKEN;
    const cfg = loadPayments([]);
    expect(cfg.usdcMonitor.enabled).toBe(false);
  });

  it("enabled only when flag + RPC + arc network all present", () => {
    process.env.USDC_MONITOR_ENABLED = "true";
    process.env.ARC_RPC_URL = "http://localhost:8545";
    process.env.EVM_CHAIN_ID = "5042002";
    process.env.ARC_USDC_TREASURY = TREASURY;
    process.env.EVM_USDC_ADDRESS = TOKEN;
    const errors: string[] = [];
    const cfg = loadPayments(errors);
    expect(cfg.usdcMonitor.enabled).toBe(true);
    expect(cfg.usdcMonitor.arcRpcUrl).toBe("http://localhost:8545");
    expect(cfg.usdcMonitor.intervalMs).toBe(30_000);
    expect(errors).toEqual([]);
  });
});

describe("222-4: exceptions via monitor", () => {
  let stores: Stores;

  const TX2 = "0x" + "cd".repeat(32);

  beforeEach(() => {
    stores = createInMemoryPaymentStores();
  });

  /** Seed a TERMINAL attempt — payable:false expectation in feed. */
  async function seedTerminal(status: "EXPIRED" | "CONFIRMED") {
    const paymentId = await seedPayment(stores);
    await stores.attempts.applyStatus(
      "att-pay1",
      "PENDING",
      status === "EXPIRED" ? "EXPIRED" : "CONFIRMED",
      NOW_MS - 1000,
      { confirmedAtMs: NOW_MS - 1000 },
    );
    return paymentId;
  }

  it("late payment on EXPIRED attempt → LATE_PAYMENT exception, status unchanged", async () => {
    await seedTerminal("EXPIRED");
    const result = await runUsdcMonitorTick(
      makeDeps(stores, mockChain([transfer(9_990_044n)])),
    );
    expect(result.confirmed).toBe(0);
    const attempt = await stores.attempts.getById("att-pay1");
    expect(attempt?.status).toBe("EXPIRED");
    const ex = await stores.exceptions!.listByPayment("pay1");
    expect(ex).toHaveLength(1);
    expect(ex[0].kind).toBe("LATE_PAYMENT");
    expect(ex[0].severity).toBe("CRITICAL");
    expect(ex[0].status).toBe("OPEN");
    const exDetails = ex[0].details as { txHash?: string };
    expect(exDetails.txHash).toBe(TX_HASH);
  });

  it("duplicate transfer on CONFIRMED attempt → DUPLICATE_TRANSFER exception, no re-confirm", async () => {
    await seedTerminal("CONFIRMED");
    const fulfill = vi.fn(async () => { });
    const result = await runUsdcMonitorTick(
      makeDeps(stores, mockChain([transfer(9_990_044n, TX2)]), fulfill),
    );
    expect(result.confirmed).toBe(0);
    const attempt = await stores.attempts.getById("att-pay1");
    expect(attempt?.status).toBe("CONFIRMED");
    const ex = await stores.exceptions!.listByPayment("pay1");
    expect(ex).toHaveLength(1);
    expect(ex[0].kind).toBe("DUPLICATE_TRANSFER");
    expect(fulfill).not.toHaveBeenCalled();
  });

  it("reorg simulation: confirmations drop below floor → stays PROCESSING, never CONFIRMED", async () => {
    await seedPayment(stores);
    // Tick 1: confirmations OK → could confirm if all checks pass.
    const good = await runUsdcMonitorTick(
      makeDeps(stores, mockChain([transfer(9_990_044n)])),
    );
    expect(good.confirmed).toBe(1);

    // Fresh attempt — simulate reorg where the SAME tx is re-seen
    // with dropped confirmations (receipt re-orgs to pending).
    const stores2 = createInMemoryPaymentStores();
    await seedPayment(stores2, { paymentId: "pay2" });
    const shallow = mockChain([transfer(9_990_044n)]);
    shallow.getConfirmations = async () => ({
      confirmations: 0,
      finalized: false,
    });
    shallow.txEvidence = async (tx) => ({
      ...tx,
      network: CAIP2,
      confirmations: 0,
      blockTimestampSec: BLOCK_TS,
    });
    const first = await runUsdcMonitorTick(
      makeDeps(stores2, shallow),
    );
    expect(first.confirmed).toBe(0);
    expect(first.pending).toBe(1);
    expect(
      (await stores2.attempts.getById("att-pay2"))?.status,
    ).toBe("PROCESSING");

    // Still unfinalized next tick — CONFIRMED stays unreachable.
    const second = await runUsdcMonitorTick(
      makeDeps(stores2, shallow),
    );
    expect(second.confirmed).toBe(0);
    expect(
      (await stores2.attempts.getById("att-pay2"))?.status,
    ).toBe("PROCESSING");
  });

  it("FUZZY flag also writes an exception row (dedupe-safe)", async () => {
    await seedPayment(stores);
    await runUsdcMonitorTick(
      makeDeps(stores, mockChain([transfer(9_990_045n)])),
    );
    const ex = await stores.exceptions!.listByPayment("pay1");
    expect(ex).toHaveLength(1);
    expect(ex[0].kind).toBe("OVERPAID");
    // Re-tick → same deterministic id, still one row.
    await runUsdcMonitorTick(
      makeDeps(stores, mockChain([transfer(9_990_045n)])),
    );
    expect(await stores.exceptions!.listByPayment("pay1")).toHaveLength(1);
  });
});

describe("fulfillment effect-context (reviews 6.1/6.2)", () => {
  let stores: Stores;
  const input = { productCode: "PASSPORT_BRONZE", metadata: {} };

  beforeEach(() => {
    resetFulfillmentRegistry();
  });

  const reg = (handler: FulfillmentHandler) =>
    new Map<string, FulfillmentHandler>([["passport-mint", handler]]);

  /** Effect-aware handler mirroring fulfillPassportMint's guard. */
  const mintHandler = (mints: number[]): FulfillmentHandler =>
    async (_input, ctx?: FulfillmentEffectContext) => {
      if (!ctx) return "executed";
      const prior = await ctx.priorEffect();
      if (prior.status === "done") return "deduped-done";
      if (prior.status === "intent") return "needs-ops";
      if (!(await ctx.markIntent())) return "deduped";
      mints.push(1);
      await ctx.markDone({ tokenId: "1" });
      return "executed";
    };

  const events = (s: Stores): FulfillmentEventStore =>
    s.events as unknown as FulfillmentEventStore;

  it("6.2 crash mid-mint: effect-done survives, stale-claim retry dedupes — no second mint", async () => {
    stores = createInMemoryPaymentStores();
    const mints: number[] = [];
    const registry = reg(mintHandler(mints));

    // First dispatch "crashes" between handler success and the
    // fulfill-done marker — simulate by NOT letting the done event in:
    // use a raw events append for claim+effect markers, then dispatch.
    await events(stores).append({
      id: "fulfill-claim-pay1",
      entity: "FULFILLMENT",
      paymentId: "pay1",
      from: "dispatch",
      to: "claimed",
      actor: "fulfillment-registry",
      atMs: NOW_MS - CLAIM_STALE_MS - 1,
    });
    await events(stores).append({
      id: "fulfill-effect-intent-pay1",
      entity: "FULFILLMENT",
      paymentId: "pay1",
      from: "claimed",
      to: "effect-intent",
      actor: "fulfillment-registry",
      atMs: NOW_MS - CLAIM_STALE_MS - 1,
    });
    await events(stores).append({
      id: "fulfill-effect-done-pay1",
      entity: "FULFILLMENT",
      paymentId: "pay1",
      from: "effect-intent",
      to: "effect-done",
      actor: "fulfillment-registry",
      atMs: NOW_MS - CLAIM_STALE_MS - 1,
      payload: { tokenId: "1" },
    });

    const status = await dispatchFulfillment(input, {
      dedupeKey: "payment:pay1",
      events: events(stores),
      registry,
      nowMs: NOW_MS,
    });
    // Handler ran but deduped on priorEffect=done → no second mint.
    expect(status).toBe("fulfilled");
    expect(mints).toHaveLength(0);
  });

  it("6.1 stale claim + live effect-intent: parallel worker must NOT run the effect", async () => {
    stores = createInMemoryPaymentStores();
    const mints: number[] = [];
    const registry = reg(mintHandler(mints));

    await events(stores).append({
      id: "fulfill-claim-pay1",
      entity: "FULFILLMENT",
      paymentId: "pay1",
      from: "dispatch",
      to: "claimed",
      actor: "fulfillment-registry",
      atMs: NOW_MS - CLAIM_STALE_MS - 1,
    });
    await events(stores).append({
      id: "fulfill-effect-intent-pay1",
      entity: "FULFILLMENT",
      paymentId: "pay1",
      from: "claimed",
      to: "effect-intent",
      actor: "fulfillment-registry",
      atMs: NOW_MS - CLAIM_STALE_MS - 1,
    });

    await dispatchFulfillment(input, {
      dedupeKey: "payment:pay1",
      events: events(stores),
      registry,
      nowMs: NOW_MS,
    });
    expect(mints).toHaveLength(0);
  });

  it("fresh claim → intent → mint → done: single end-to-end effect", async () => {
    stores = createInMemoryPaymentStores();
    const mints: number[] = [];
    const registry = reg(mintHandler(mints));

    const status = await dispatchFulfillment(input, {
      dedupeKey: "payment:pay1",
      events: events(stores),
      registry,
      nowMs: NOW_MS,
    });
    expect(status).toBe("fulfilled");
    expect(mints).toHaveLength(1);
    const rows = await events(stores).listByPayment("pay1");
    const kinds = rows.map((r) => r.to);
    expect(kinds).toContain("claimed");
    expect(kinds).toContain("effect-intent");
    expect(kinds).toContain("effect-done");
    expect(kinds).toContain("done");

    // Re-dispatch after done → durable dedupe, handler never re-runs.
    const again = await dispatchFulfillment(input, {
      dedupeKey: "payment:pay1",
      events: events(stores),
      registry,
      nowMs: NOW_MS + 1,
    });
    expect(again).toBe("deduped");
    expect(mints).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Audit 222-7 regressions — C-1 unresolved, H-9 reclaim, H-6 isolation
// ---------------------------------------------------------------------------

describe("audit-222-7", () => {
  let stores: Stores;
  const input = { productCode: "PASSPORT_BRONZE", metadata: {} };

  beforeEach(() => {
    stores = createInMemoryPaymentStores();
    resetFulfillmentRegistry();
  });

  const events = (s: Stores): FulfillmentEventStore =>
    s.events as unknown as FulfillmentEventStore;

  it("C-1: needs-ops handler → 'unresolved' + durable marker, NO done", async () => {
    const registry = new Map<string, FulfillmentHandler>([
      ["passport-mint", async () => "needs-ops" as const],
    ]);
    const status = await dispatchFulfillment(input, {
      dedupeKey: "payment:pay9",
      events: events(stores),
      registry,
      nowMs: NOW_MS,
    });
    expect(status).toBe("unresolved");
    const rows = await events(stores).listByPayment("pay9");
    const kinds = rows.map((r) => r.to);
    expect(kinds).toContain("unresolved");
    expect(kinds).not.toContain("done");
  });

  it("C-1: executed handler → 'fulfilled' + done marker", async () => {
    const registry = new Map<string, FulfillmentHandler>([
      ["passport-mint", async () => "executed" as const],
    ]);
    const status = await dispatchFulfillment(input, {
      dedupeKey: "payment:pay10",
      events: events(stores),
      registry,
      nowMs: NOW_MS,
    });
    expect(status).toBe("fulfilled");
    const rows = await events(stores).listByPayment("pay10");
    expect(rows.map((r) => r.to)).toContain("done");
  });

  it("H-9: stale claim reclaimed once — a second stale-claim dispatch dedupes", async () => {
    let calls = 0;
    const registry = new Map<string, FulfillmentHandler>([
      [
        "passport-mint",
        async () => {
          calls++;
          return "executed" as const;
        },
      ],
    ]);
    await events(stores).append({
      id: "fulfill-claim-pay11",
      entity: "FULFILLMENT",
      paymentId: "pay11",
      from: "dispatch",
      to: "claimed",
      actor: "fulfillment-registry",
      atMs: NOW_MS - CLAIM_STALE_MS - 1,
    });
    const first = await dispatchFulfillment(input, {
      dedupeKey: "payment:pay11",
      events: events(stores),
      registry,
      nowMs: NOW_MS,
    });
    expect(first).toBe("fulfilled");
    expect(calls).toBe(1);
    // After reclaim + done, another dispatch is a plain dedupe —
    // the reclaim path never re-runs the handler.
    const second = await dispatchFulfillment(input, {
      dedupeKey: "payment:pay11",
      events: events(stores),
      registry,
      nowMs: NOW_MS + 1,
    });
    expect(second).toBe("deduped");
    expect(calls).toBe(1);
  });

  it("H-6: malformed attempt does not abort the rest of the network group", async () => {
    await seedPayment(stores);
    // Second attempt with a corrupt expectedAmount — toExpectation throws.
    await stores.payments.create({
      id: "pay-bad",
      reference: "ref-pay-bad",
      amount: "9.990044",
      currency: "USD",
      status: "PROCESSING",
      purpose: "ORDER",
      createdAtMs: NOW_MS,
      updatedAtMs: NOW_MS,
      payload: {},
    });
    await stores.attempts.create({
      id: "att-pay-bad",
      paymentId: "pay-bad",
      provider: "DIRECT_USDC",
      network: CAIP2,
      token: TOKEN,
      amount: "not-a-number",
      currency: "USDC",
      status: "PENDING",
      providerReference: `usdc_${CAIP2}_pay-bad`,
      expiresAtMs: NOW_MS + 3_600_000,
      payload: {
        expectedRecipient: TREASURY,
        expectedAmount: "not-a-number",
        network: CAIP2,
        minConfirmations: 1,
      },
    });
    const fulfill = vi.fn(async () => {});
    const result = await runUsdcMonitorTick(
      makeDeps(stores, mockChain([transfer(9_990_044n)]), fulfill),
    );
    expect(result.errors.length).toBeGreaterThan(0);
    // Healthy attempt still confirms.
    expect(result.confirmed).toBe(1);
    expect(fulfill).toHaveBeenCalledWith("pay1");
  });
});
