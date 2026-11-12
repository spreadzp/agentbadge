/**
 * SLICE-222-5 — reconciliation sweeper tests.
 *
 * Core contract (D-222-5): periodic USDC-only diff of attempts ↔
 * chain Transfers ↔ receipts → PaymentException rows (kind
 * RECONCILIATION_MISMATCH), dedupe by deterministic id, and a
 * per-network cursor so runs are incremental, never full-history.
 */
import { describe, expect, it } from "vitest";
import {
  createInMemoryPaymentStores,
  getPaymentNetwork,
  type ArcChainClient,
  type DecodedTransfer,
} from "@agentbadge/payments";
import {
  runReconciliationTick,
  type ReconciliationCursorStore,
} from "../src/server/lib/payments-api/usdc-reconciliation";

const CAIP2 = "eip155:5042002";
const TOKEN = "0x3600000000000000000000000000000000000000";
const TREASURY = "0x1111111111111111111111111111111111111111";
const PAYER = "0x2222222222222222222222222222222222222222";
const NOW_MS = 1_700_000_000_000;
const TX_HASH =
  "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

type Stores = ReturnType<typeof createInMemoryPaymentStores>;

function fakeChain(transfers: DecodedTransfer[], head = 5000n) {
  const calls: { fromBlock: bigint; toBlock: bigint }[] = [];
  const client: ArcChainClient = {
    network: getPaymentNetwork(CAIP2)!,
    getHead: async () => head,
    scanTransfers: async (input) => {
      calls.push({ fromBlock: input.fromBlock, toBlock: input.toBlock });
      return transfers;
    },
    getTxReceipt: async () => null,
    getConfirmations: async () => ({ confirmations: 0, finalized: false }),
    getBlockTimestamp: async () => NOW_MS / 1000,
    txEvidence: async (tx) => ({
      ...tx,
      network: CAIP2,
      confirmations: 0,
    }),
  };
  return { client, calls };
}

function memoryCursor(): ReconciliationCursorStore {
  const map = new Map<string, bigint>();
  return {
    get: async (k) => map.get(k) ?? null,
    set: async (k, b) => void map.set(k, b),
  };
}

function transfer(
  amountUnits: bigint,
  txHash = TX_HASH,
): DecodedTransfer {
  return {
    txHash,
    logIndex: 0,
    from: PAYER,
    to: TREASURY,
    amountUnits,
    blockNumber: 4900n,
  };
}

async function seed(
  stores: Stores,
  opts: {
    attemptStatus?: string;
    txHash?: string | null;
    withReceipt?: boolean;
  } = {},
) {
  const amount = "9.990044";
  await stores.payments.create({
    id: "pay1",
    reference: "ref-pay1",
    amount,
    currency: "USD",
    status: opts.attemptStatus === "CONFIRMED" ? "CONFIRMED" : "PROCESSING",
    purpose: "ORDER",
    createdAtMs: NOW_MS - 60_000,
    updatedAtMs: NOW_MS - 30_000,
    payload: {},
  });
  await stores.attempts.create({
    id: "att-pay1",
    paymentId: "pay1",
    provider: "DIRECT_USDC",
    network: CAIP2,
    token: TOKEN,
    amount,
    currency: "USDC",
    status: opts.attemptStatus ?? "PENDING",
    providerReference: `usdc_${CAIP2}_pay1`,
    transactionHash: opts.txHash ?? undefined,
    expiresAtMs: NOW_MS + 3_600_000,
    payload: {
      expectedRecipient: TREASURY,
      expectedAmount: amount,
      network: CAIP2,
      minConfirmations: 1,
    },
  });
  if (opts.withReceipt) {
    await stores.receipts.append({
      id: "rcpt-pay1",
      paymentId: "pay1",
      attemptId: "att-pay1",
      provider: "DIRECT_USDC",
      externalReference: opts.txHash ?? TX_HASH,
      network: CAIP2,
      transactionHash: opts.txHash ?? TX_HASH,
      payer: PAYER,
      recipient: TREASURY,
      amount,
      asset: "USDC",
      verifiedAtMs: NOW_MS - 20_000,
      payload: {},
    });
  }
}

function deps(
  stores: Stores,
  client: ArcChainClient,
  cursorStore?: ReconciliationCursorStore,
) {
  return {
    stores,
    chainFor: () => client,
    networks: [CAIP2],
    treasuryFor: () => TREASURY,
    cursorStore,
    nowMs: () => NOW_MS,
    lookbackBlocks: 4096n,
  };
}

describe("222-5: reconciliation tick", () => {
  it("CONFIRMED attempt without receipt → exception row", async () => {
    const stores = createInMemoryPaymentStores();
    // Terminalize → CONFIRMED lands in listRecentTerminal feed.
    await seed(stores, { txHash: TX_HASH });
    await stores.attempts.applyStatus(
      "att-pay1",
      "PENDING",
      "CONFIRMED",
      NOW_MS - 10_000,
    );
    const { client } = fakeChain([transfer(9_990_044n)]);
    const res = await runReconciliationTick(deps(stores, client));
    const rows = await stores.exceptions!.list({ status: "OPEN" });
    const kinds = rows.map((r) => r.details?.mismatchKind);
    expect(kinds).toContain("CONFIRMED_WITHOUT_RECEIPT");
    expect(res.exceptionsWritten).toBeGreaterThan(0);
  });

  it("stray treasury transfer → CHAIN_TX_WITHOUT_ATTEMPT", async () => {
    const stores = createInMemoryPaymentStores();
    // Different amount → not related to the open attempt, no receipt.
    await seed(stores);
    const { client } = fakeChain([transfer(1n, TX_HASH)]);
    await runReconciliationTick(deps(stores, client));
    const rows = await stores.exceptions!.list({ status: "OPEN" });
    const stray = rows.find(
      (r) => r.details?.mismatchKind === "CHAIN_TX_WITHOUT_ATTEMPT",
    );
    expect(stray).toBeDefined();
    expect(stray!.kind).toBe("RECONCILIATION_MISMATCH");
    expect(stray!.severity).toBe("WARN");
  });

  it("dedupe: second run writes zero new exceptions", async () => {
    const stores = createInMemoryPaymentStores();
    await seed(stores);
    const { client } = fakeChain([transfer(1n, TX_HASH)]);
    const d = deps(stores, client);
    const first = await runReconciliationTick(d);
    const second = await runReconciliationTick(d);
    expect(first.exceptionsWritten).toBeGreaterThan(0);
    expect(second.exceptionsWritten).toBe(0);
    const rows = await stores.exceptions!.list({ status: "OPEN" });
    expect(rows).toHaveLength(1); // only the stray-tx exception
  });

  it("cursor: second run scans nothing new when head unchanged", async () => {
    const stores = createInMemoryPaymentStores();
    await seed(stores);
    const { client, calls } = fakeChain([]);
    const cursorStore = memoryCursor();
    const d = deps(stores, client, cursorStore);
    await runReconciliationTick(d);
    expect(await cursorStore.get(CAIP2)).toBe(5000n);
    calls.length = 0;
    const res = await runReconciliationTick(d);
    expect(calls).toHaveLength(0); // cursor+1 > head → skip
    expect(res.transfersSeen).toBe(0);
  });

  it("cursor: new blocks → scans only (cursor+1..head)", async () => {
    const stores = createInMemoryPaymentStores();
    await seed(stores);
    const { client, calls } = fakeChain([], 5000n);
    const cursorStore = memoryCursor();
    const d = deps(stores, client, cursorStore);
    await runReconciliationTick(d);
    // Chain grows by 10 blocks → narrow incremental window.
    (client as { getHead: () => Promise<bigint> }).getHead = async () =>
      5010n;
    await runReconciliationTick(d);
    expect(calls[1]).toEqual({ fromBlock: 5001n, toBlock: 5010n });
  });

  it("clean state → no exceptions", async () => {
    const stores = createInMemoryPaymentStores();
    await seed(stores, { txHash: TX_HASH, withReceipt: true });
    await stores.attempts.applyStatus(
      "att-pay1",
      "PENDING",
      "CONFIRMED",
      NOW_MS - 10_000,
    );
    const { client } = fakeChain([transfer(9_990_044n)]);
    const res = await runReconciliationTick(deps(stores, client));
    expect(res.mismatches).toEqual({});
    expect(res.exceptionsWritten).toBe(0);
  });
});
