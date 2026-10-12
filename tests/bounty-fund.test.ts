/**
 * SLICE-197-11: fund caps + BOUNTY_ENABLED gate.
 * - disabled → 503 bounty_disabled
 * - single/daily/weekly caps → 402 spend_cap BEFORE any tx
 * - lazy createJob when onchainJobId missing (JobCreated decode)
 * - idempotent: funded onchain or recorded → no duplicate approve
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { decodeFunctionData, keccak256, toBytes } from "viem";
import { ERC8183_ABI, ERC8183_ACP_ABI } from "@agentbadge/circle-payments";

import {
  checkFundCaps,
  fundBounty,
  type FundDeps,
} from "../src/server/lib/bounties/fund";
import {
  resetBountyStoreForTesting,
  upsertBounty,
  appendTransition,
  useMemoryBountyStoreForTesting,
  type BountyRecord,
} from "../src/server/lib/bounties/store";
import type { PreparedTx } from "../src/server/lib/venue/lifecycle";
import type { OnchainJob, VenueNetwork } from "../src/server/lib/venue/chain";
import { ARC_TESTNET } from "@agentbadge/circle-payments";

const JOB = "0x80040000000000000000000000000000000000ff" as const;
const USDC = "0x5555555555555555555555555555555555555555" as const;

function net(variant: "circle" | "acp" = "circle"): VenueNetwork {
  return {
    name: variant,
    chain: { ...ARC_TESTNET, usdc: USDC },
    agenticCommerce: JOB,
    identityRegistry: JOB,
    reputationRegistry: JOB,
    memo: JOB,
    variant,
    abi: variant === "acp" ? ERC8183_ACP_ABI : ERC8183_ABI,
    explorerTx: (h: string) => `https://explorer/tx/${h}`,
    explorerAddr: (a: string) => `https://explorer/address/${a}`,
  } as VenueNetwork;
}

function bounty(over: Partial<BountyRecord> = {}): BountyRecord {
  return {
    bountyId: "b1",
    title: "t",
    brief: { criteria: ["c"], deliverableType: "pr" },
    budgetUsdc: "5",
    status: "open",
    onchainJobId: "42",
    jobAttempt: 1,
    createdAt: new Date().toISOString(),
    ...over,
  };
}

function deps(sent: PreparedTx[] = []): FundDeps & { sent: PreparedTx[] } {
  return {
    network: () => net(),
    now: () => 10_000_000,
    enabled: true,
    sent,
    send: async (txs) => {
      sent.push(...txs);
      return txs.map((t, i) => keccak256(toBytes(`${t.to}:${t.data}:${i}`)));
    },
    readJob: () => Promise.resolve(null),
  };
}

beforeEach(() => useMemoryBountyStoreForTesting());
afterEach(() => resetBountyStoreForTesting());

describe("BOUNTY_ENABLED gate", () => {
  it("disabled → 503, zero txs", async () => {
    upsertBounty(bounty());
    const d = deps();
    const r = await fundBounty("b1", { ...d, enabled: false });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(503);
      expect(r.code).toBe("bounty_disabled");
    }
    expect(d.sent).toHaveLength(0);
  });
});

describe("checkFundCaps", () => {
  it("single cap: below min / above max → spend_cap", () => {
    expect(checkFundCaps(0.5, 0).ok).toBe(false);
    expect(checkFundCaps(6, 0).ok).toBe(false);
    expect(checkFundCaps(5, 0).ok).toBe(true);
  });

  it("daily cap blocks cumulative spend", () => {
    // 5 already funded today → next 5 would exceed 25? no; use cap 10.
    upsertBounty(bounty());
    process.env.BOUNTY_DAILY_CAP_USDC = "10";
    appendTransition({
      id: "t1", bountyId: "b1", actor: "ops", from: "open",
      to: "open", reason: "funded", atMs: 9_000_000,
      payload: { amount: 8 },
    });
    const r = checkFundCaps(5, 10_000_000);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.cap).toBe("daily");
    delete process.env.BOUNTY_DAILY_CAP_USDC;
  });

  it("weekly cap blocks across days", () => {
    upsertBounty(bounty());
    process.env.BOUNTY_WEEKLY_CAP_USDC = "20";
    for (let i = 0; i < 4; i++) {
      appendTransition({
        id: `tw${i}`, bountyId: "b1", actor: "ops", from: "open",
        to: "open", reason: "funded", atMs: 10_000_000 - i * 3_600_000,
        payload: { amount: 5 },
      });
    }
    const r = checkFundCaps(1, 10_000_000);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.cap).toBe("weekly");
    delete process.env.BOUNTY_WEEKLY_CAP_USDC;
  });

  it("old funded rows outside window don't count", () => {
    upsertBounty(bounty());
    appendTransition({
      id: "old", bountyId: "b1", actor: "ops", from: "open",
      to: "open", reason: "funded", atMs: 1_000,
      payload: { amount: 5 },
    });
    expect(checkFundCaps(5, 10_000_000).ok).toBe(true);
  });
});

describe("fundBounty", () => {
  it("fund: approve(USDC) + fund(jobId) sent, chainTxs.funded set", async () => {
    upsertBounty(bounty());
    const d = deps();
    const r = await fundBounty("b1", d);
    expect(r.ok).toBe(true);
    expect(d.sent).toHaveLength(2);
    // Tx1 = ERC20 approve, Tx2 = fund(jobId).
    const fundDec = decodeFunctionData({ abi: ERC8183_ABI,
      data: d.sent[1].data });
    expect(d.sent[0].to).toBe(USDC);
    expect(fundDec.functionName).toBe("fund");
    // Transition logged for cap accounting.
    const { getBounty } = await import(
      "../src/server/lib/bounties/store");
    expect(getBounty("b1")!.chainTxs?.funded).toMatch(/^0x/);
  });

  it("acp variant: fund(jobId, expectedBudget)", async () => {
    upsertBounty(bounty());
    const d = { ...deps(), network: () => net("acp") };
    const sent: PreparedTx[] = [];
    const r = await fundBounty("b1", { ...d,
      send: async (txs) => { sent.push(...txs);
        return txs.map((t, i) => keccak256(toBytes(`${t.to}:${i}`))); } });
    expect(r.ok).toBe(true);
    const dec = decodeFunctionData({ abi: ERC8183_ACP_ABI,
      data: sent[1].data });
    expect(dec.functionName).toBe("fund");
    expect(dec.args[0]).toBe(42n);
  });

  it("lazy createJob: no onchainJobId → createJob first, jobId from decode", async () => {
    upsertBounty(bounty({ onchainJobId: undefined }));
    const sent: PreparedTx[] = [];
    const r = await fundBounty("b1", {
      network: () => net(),
      enabled: true,
      now: () => 10_000_000,
      send: async (txs) => { sent.push(...txs);
        return txs.map((t, i) => keccak256(toBytes(`${t.to}:${i}`))); },
      fetchJobId: () => Promise.resolve(77),
      readJob: () => Promise.resolve(null),
    });
    expect(r.ok).toBe(true);
    // createJob + approve + fund = 3 txs.
    expect(sent).toHaveLength(3);
    const cjDec = decodeFunctionData({ abi: ERC8183_ABI,
      data: sent[0].data });
    expect(cjDec.functionName).toBe("createJob");
    const fundDec = decodeFunctionData({ abi: ERC8183_ABI,
      data: sent[2].data });
    expect(fundDec.args[0]).toBe(77n);
  });

  it("idempotent: chainTxs.funded recorded → no txs", async () => {
    upsertBounty(bounty({ chainTxs: { funded: "0xabc" } }));
    const d = deps();
    const r = await fundBounty("b1", d);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.idempotent).toBe(true);
    expect(d.sent).toHaveLength(0);
  });

  it("idempotent: onchain status ≥ Funded → no txs", async () => {
    upsertBounty(bounty());
    const d = deps();
    const r = await fundBounty("b1", { ...d,
      readJob: () => Promise.resolve({
        status: 1, budget: 5_000_000n,
      } as OnchainJob) });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.idempotent).toBe(true);
    expect(d.sent).toHaveLength(0);
  });

  it("cap exceeded → 402 spend_cap before any tx", async () => {
    upsertBounty(bounty({ budgetUsdc: "50" }));
    const d = deps();
    const r = await fundBounty("b1", d);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(402);
      expect(r.code).toBe("spend_cap");
    }
    expect(d.sent).toHaveLength(0);
  });

  it("wrong status → 409", async () => {
    upsertBounty(bounty({ status: "submitted" }));
    const r = await fundBounty("b1", { enabled: true, network: () => net() });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(409);
  });
});
