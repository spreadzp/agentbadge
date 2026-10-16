/**
 * SLICE-199-13: unit coverage for drainBoardOutbox — the ChainTxOutbox
 * ops-signer worker (D-199-7). Stubs the sender + onchain reader so the
 * tests assert composition/ordering/idempotency without RPC.
 */
import { beforeEach, describe, expect, it } from "vitest";

import { ARC_TESTNET, ERC8183_ABI } from "@agentbadge/circle-payments";

import { drainBoardOutbox } from "../src/server/lib/board/dispatch";
import type { RefJob } from "../src/server/lib/board/erc8183-ref";
import { REF_STATUS, ZERO_ADDR } from "../src/server/lib/board/erc8183-ref";
import type { ChainTxOutboxRecord } from "../src/server/lib/board/types";
import type { PreparedTx } from "../src/server/lib/venue/lifecycle";
import type { VenueNetwork } from "../src/server/lib/venue/chain";
import { getBounty, upsertBounty, upsertClaim } from "../src/server/lib/bounties/store";

const ESCROW = "0x0049e5362736c933055e502b3cf3ba90cc0bf6a0" as `0x${string}`;
const PROV_EOA = "0x1111111111111111111111111111111111111111" as `0x${string}`;
const OPS_EOA = "0x2222222222222222222222222222222222222222" as `0x${string}`;
const AGENT_WALLET = "0x3333333333333333333333333333333333333333" as `0x${string}`;
const D32 = `0x${"ab".repeat(32)}` as `0x${string}`;

function net(): VenueNetwork {
  return {
    name: "testnet",
    chain: { ...ARC_TESTNET, usdc: ARC_TESTNET.usdc },
    agenticCommerce: ESCROW,
    reputationRegistry: "0x4444444444444444444444444444444444444444",
    identityRegistry: "0x5555555555555555555555555555555555555555",
    memo: "0x6666666666666666666666666666666666666666",
    abi: ERC8183_ABI,
    variant: "circle",
    explorerTx: (h) => `https://testnet.arcscan.app/tx/${h}`,
    explorerAddr: (a) => `https://testnet.arcscan.app/address/${a}`,
  };
}

function refJob(over: Partial<RefJob> = {}): RefJob {
  return {
    client: OPS_EOA,
    status: REF_STATUS.Open,
    provider: ZERO_ADDR,
    expiredAt: 0n,
    evaluator: OPS_EOA,
    submittedAt: 0n,
    budget: 0n,
    hook: ZERO_ADDR,
    paymentToken: ZERO_ADDR,
    providerAgentId: 0n,
    description: "",
    settledAmount: 0n,
    payoutReceiver: ZERO_ADDR,
    ...over,
  };
}

function outboxRow(kind: string, over: Partial<ChainTxOutboxRecord> = {}): ChainTxOutboxRecord {
  return {
    id: `o-${kind}-1`,
    kind: kind as never,
    cardId: "card-1",
    jobAttempt: 1,
    idempotencyKey: `board:card-1:1:${kind}`,
    status: "pending",
    attempts: 0,
    payload: {},
    // 10ms into the past — the real store contract is createdAt < cutoff,
    // and a row stamped in the same ms as the drain falls outside it.
    createdAt: new Date(Date.now() - 10).toISOString(),
    ...over,
  };
}

interface StubStore {
  rows: ChainTxOutboxRecord[];
  listPendingOutbox: (olderThanMs: number) => ChainTxOutboxRecord[];
  patchOutbox: (id: string, patch: Partial<ChainTxOutboxRecord>) => ChainTxOutboxRecord | undefined;
  getCard: (id: string) => { cardId: string; bountyId: string } | undefined;
}

function stubStore(rows: ChainTxOutboxRecord[]): StubStore {
  const patched: ChainTxOutboxRecord[] = [];
  return {
    rows: patched,
    // Mirror the real store contract: pending rows whose createdAt is
    // strictly before the epoch-ms cutoff. Ignoring the cutoff here is
    // what let the 0-default bug reach production undetected.
    listPendingOutbox: (cutoffMs) =>
      rows.filter(
        (r) =>
          r.status === "pending" &&
          new Date(r.createdAt).getTime() < cutoffMs,
      ),
    patchOutbox: (id, patch) => {
      const idx = rows.findIndex((r) => r.id === id);
      if (idx < 0) return undefined;
      rows[idx] = { ...rows[idx], ...patch } as ChainTxOutboxRecord;
      patched.push(rows[idx]);
      return rows[idx];
    },
    getCard: (id) => ({ cardId: id, bountyId: `b-${id}` }),
  };
}

/** Capture (role, tx) sequence from an injected sender. */
function stubSender(calls: { role: string; txs: PreparedTx[] }[] = []) {
  return {
    calls,
    send: async (role: string, txs: PreparedTx[]) => {
      calls.push({ role, txs });
      return txs.map((_, i) => `0xhash${calls.length}${i}` as `0x${string}`);
    },
  };
}

describe("drainBoardOutbox", () => {
  beforeEach(() => {
    process.env.ERC8183_REF_ADDRESS = ESCROW;
    upsertBounty({
      bountyId: "b-card-1",
      title: "t",
      brief: { criteria: [], deliverableType: "pr" },
      budgetUsdc: "1",
      status: "claimed",
      jobAttempt: 1,
      createdAt: new Date().toISOString(),
    } as never);
    upsertClaim({
      id: "b-card-1:1",
      bountyId: "b-card-1",
      jobAttempt: 1,
      passportId: "p-1",
      payoutWallet: AGENT_WALLET,
      state: "open",
      claimedAtMs: Date.now(),
      leaseUntilMs: Date.now() + 60_000,
    });
  });

  it("refuses non-ref venue networks", async () => {
    const res = await drainBoardOutbox({
      network: { ...net(), agenticCommerce: "0x9999999999999999999999999999999999999999" },
      store: stubStore([outboxRow("submit")]) as never,
    });
    expect(res.errors[0]).toContain("ref");
    expect(res.processed).toBe(0);
  });

  it("is a no-op when ERC8183_REF_ADDRESS is unset", async () => {
    delete process.env.ERC8183_REF_ADDRESS;
    const res = await drainBoardOutbox({
      network: net(),
      store: stubStore([outboxRow("submit")]) as never,
    });
    expect(res.processed).toBe(0);
    expect(res.errors[0]).toContain("ref");
  });

  it("submit on Open job composes bind+fund+submit legs", async () => {
    const bounty = getBounty("b-card-1")!;
    upsertBounty({ ...bounty, onchainJobId: "7" });
    const sender = stubSender();
    const job = refJob(); // Open, no provider
    const res = await drainBoardOutbox({
      network: net(),
      store: stubStore([
        outboxRow("submit", { payload: { deliverableHash: D32 } }),
      ]) as never,
      sendTxs: sender.send,
      readJob: async () => job,
    });
    expect(res.failed).toBe(0);
    expect(res.confirmed).toBe(1);
    // legs: client setProvider → provider setPayoutReceiver+setBudget
    //       → client approve+fund → provider submit
    const roles = sender.calls.map((c) => c.role);
    expect(roles).toEqual(["client", "provider", "client", "provider"]);
    expect(res.errors).toEqual([]);
  });

  it("submit on Funded job sends only submit", async () => {
    const bounty = getBounty("b-card-1")!;
    upsertBounty({ ...bounty, onchainJobId: "7" });
    const sender = stubSender();
    const job = refJob({ status: REF_STATUS.Funded, provider: PROV_EOA });
    const res = await drainBoardOutbox({
      network: net(),
      store: stubStore([outboxRow("submit", { payload: { deliverableHash: D32 } })]) as never,
      sendTxs: sender.send,
      readJob: async () => job,
    });
    expect(res.confirmed).toBe(1);
    expect(sender.calls.map((c) => c.role)).toEqual(["provider"]);
  });

  it("submit on Submitted job is a noop → confirmed without send", async () => {
    const bounty = getBounty("b-card-1")!;
    upsertBounty({ ...bounty, onchainJobId: "7" });
    const sender = stubSender();
    const job = refJob({ status: REF_STATUS.Submitted, provider: PROV_EOA });
    const res = await drainBoardOutbox({
      network: net(),
      store: stubStore([outboxRow("submit")]) as never,
      sendTxs: sender.send,
      readJob: async () => job,
    });
    expect(res.confirmed).toBe(1);
    expect(sender.calls).toHaveLength(0);
  });

  it("selects a just-created pending row (regression: cutoff is epoch-ms, not 0)", async () => {
    const bounty = getBounty("b-card-1")!;
    upsertBounty({ ...bounty, onchainJobId: "7" });
    const sender = stubSender();
    const job = refJob({ status: REF_STATUS.Submitted, provider: PROV_EOA });
    // Row created "now" — under the pre-fix cutoff (0) the store would
    // select nothing and this drain would silently skip the row.
    const res = await drainBoardOutbox({
      network: net(),
      store: stubStore([outboxRow("submit")]) as never,
      sendTxs: sender.send,
      readJob: async () => job,
    });
    expect(res.processed).toBe(1);
    expect(res.confirmed).toBe(1);
  });

  it("olderThanMs skips rows newer than the delay", async () => {
    const sender = stubSender();
    const res = await drainBoardOutbox({
      network: net(),
      store: stubStore([outboxRow("submit")]) as never,
      sendTxs: sender.send,
      readJob: async () => refJob(),
      olderThanMs: 60_000,
    });
    expect(res.processed).toBe(0);
    expect(sender.calls).toHaveLength(0);
  });

  it("send failure keeps row pending and records lastError", async () => {
    const bounty = getBounty("b-card-1")!;
    upsertBounty({ ...bounty, onchainJobId: "7" });
    const rows = [outboxRow("submit", { payload: { deliverableHash: D32 } })];
    const st = stubStore(rows);
    const res = await drainBoardOutbox({
      network: net(),
      store: st as never,
      sendTxs: async () => null,
      readJob: async () => refJob({ status: REF_STATUS.Funded, provider: PROV_EOA }),
    });
    expect(res.failed).toBe(1);
    expect(rows[0].status).toBe("pending");
    expect(rows[0].attempts).toBe(1);
    expect(rows[0].lastError).toContain("submit");
  });

  it("createJob stores decoded onchainJobId on the bounty", async () => {
    const bounty = getBounty("b-card-1")!;
    expect(bounty.onchainJobId).toBeUndefined();
    process.env.ARC_VENUE_PROVIDER_KEY ||= "0x" + "11".repeat(32);
    process.env.ARC_EVALUATOR_KEY ||= "0x" + "22".repeat(32);
    process.env.DEPLOYER_PRIVATE_KEY ||= "0x" + "33".repeat(32);
    const rows = [
      outboxRow("createJob", { payload: { bountyId: "b-card-1" } }),
    ];
    const res = await drainBoardOutbox({
      network: net(),
      store: stubStore(rows) as never,
      sendTxs: async () => ["0xcafe" as `0x${string}`],
      decodeJobId: async () => 42n,
    });
    expect(res.confirmed).toBe(1);
    expect(getBounty("b-card-1")!.onchainJobId).toBe("42");
    expect(rows[0].status).toBe("confirmed");
    expect(rows[0].txHash).toBe("0xcafe");
  });

  it("giveFeedback builds a client-role tx on the reputation registry", async () => {
    const sender = stubSender();
    const res = await drainBoardOutbox({
      network: net(),
      store: stubStore([
        outboxRow("giveFeedback", {
          cardId: null as never,
          payload: {
            agentId: "9",
            value: "1",
            decimals: 0,
            tag1: "board",
            tag2: "qa",
            feedbackURI: "data:application/json,{}",
            hash: null,
          },
        }),
      ]) as never,
      sendTxs: sender.send,
    });
    expect(res.confirmed).toBe(1);
    expect(sender.calls[0].role).toBe("client");
    expect(sender.calls[0].txs[0].to.toLowerCase()).toBe(
      net().reputationRegistry.toLowerCase(),
    );
  });

  it("claimRefund is a no-op when the job is already Completed", async () => {
    const bounty = getBounty("b-card-1")!;
    upsertBounty({ ...bounty, onchainJobId: "7" });
    const sender = stubSender();
    const res = await drainBoardOutbox({
      network: net(),
      store: stubStore([outboxRow("claimRefund")]) as never,
      sendTxs: sender.send,
      readJob: async () => refJob({ status: REF_STATUS.Completed, provider: PROV_EOA }),
    });
    expect(res.confirmed).toBe(1);
    expect(sender.calls).toHaveLength(0);
  });
});
