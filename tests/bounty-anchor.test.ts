/**
 * SLICE-197-10: verdict memo-anchor — PASS/FAIL get verdictMemoTx on
 * the outcome, onchain reason = memoId (verifiable pointer into the
 * Memo event), idempotent (no duplicate tx), verify route shape.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { decodeFunctionData, keccak256, toBytes } from "viem";
import { MEMO_ABI, ERC8183_ABI } from "@agentbadge/circle-payments";

import {
  anchorBountyOutcome,
  anchorSweep,
  encodeVerdictMemo,
  verdictMemoId,
  type AnchorDeps,
} from "../src/server/lib/bounties/anchor";
import {
  getOutcome,
  resetBountyStoreForTesting,
  upsertBounty,
  putOutcome,
  useMemoryBountyStoreForTesting,
  type BountyOutcomeRecord,
  type BountyRecord,
} from "../src/server/lib/bounties/store";
import type { PreparedTx } from "../src/server/lib/venue/lifecycle";
import type { VenueNetwork } from "../src/server/lib/venue/chain";
import { ARC_TESTNET } from "@agentbadge/circle-payments";

const SHA = "abc1234";
const JOB = "0x80040000000000000000000000000000000000ff" as const;
const MEMO = "0x5294E9927c3306DcBaDb03fe70b92e01cCede505" as const;

function net(): VenueNetwork {
  return {
    name: "testnet",
    chain: ARC_TESTNET,
    agenticCommerce: JOB,
    identityRegistry: JOB,
    reputationRegistry: JOB,
    memo: MEMO,
    variant: "circle",
    abi: ERC8183_ABI,
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
    status: "passed",
    onchainJobId: "42",
    jobAttempt: 1,
    createdAt: new Date().toISOString(),
    ...over,
  };
}

function outcome(over: Partial<BountyOutcomeRecord> = {}) {
  return {
    id: "b1:1",
    bountyId: "b1",
    jobAttempt: 1,
    passportId: "p1",
    verdict: "pass" as const,
    reasonCodes: [] as string[],
    commitSha: SHA,
    payload: { checks: [{ name: "build", ok: true }] },
    ...over,
  };
}

function deps(sent: PreparedTx[] = []): AnchorDeps & {
  sent: PreparedTx[];
} {
  return {
    network: net,
    now: () => 10_000_000,
    sent,
    send: async (txs) => {
      sent.push(...txs);
      return txs.map((t, i) =>
        keccak256(toBytes(`${t.to}:${t.data}:${i}`)));
    },
  };
}

beforeEach(() => useMemoryBountyStoreForTesting());
afterEach(() => resetBountyStoreForTesting());

describe("anchorBountyOutcome", () => {
  it("PASS: memo tx to MEMO_CONTRACT + complete(reason=memoId)", async () => {
    upsertBounty(bounty());
    putOutcome(outcome());
    const d = deps();
    const r = await anchorBountyOutcome(bounty(), outcome(), d);
    expect(r.ok).toBe(true);
    expect(r.memoTxHash).toMatch(/^0x/);
    expect(r.actionTxHash).toMatch(/^0x/);
    // Two txs: memo anchor + complete.
    expect(d.sent).toHaveLength(2);
    // Tx1: memo(identityRegistry, name(), memoId, memoData).
    const memoDec = decodeFunctionData({ abi: MEMO_ABI,
      data: d.sent[0].data });
    expect(d.sent[0].to).toBe(MEMO);
    expect(memoDec.functionName).toBe("memo");
    const memoId = memoDec.args[2] as string;
    expect(memoId).toBe(verdictMemoId("b1", 1, SHA));
    // Tx2: complete(jobId, reason=memoId).
    const compDec = decodeFunctionData({ abi: ERC8183_ABI,
      data: d.sent[1].data });
    expect(d.sent[1].to).toBe(JOB);
    expect(compDec.functionName).toBe("complete");
    expect(compDec.args[0]).toBe(42n);
    expect(compDec.args[1]).toBe(memoId);
    // Outcome patched with hashes + explorer links.
    const o = getOutcome("b1", 1)!;
    expect(o.verdictMemoTx).toBe(r.memoTxHash);
    expect(o.verdictRejectTx).toBe(r.actionTxHash);
    expect((o.payload as { explorerTxs: { memo: string } })
      .explorerTxs.memo).toContain(r.memoTxHash);
  });

  it("FAIL: memo tx then reject(reason=memoId)", async () => {
    upsertBounty(bounty({ status: "failed" }));
    putOutcome(outcome({ verdict: "fail",
      reasonCodes: ["qa_test_failed"] }));
    const d = deps();
    const r = await anchorBountyOutcome(
      bounty({ status: "failed" }),
      outcome({ verdict: "fail", reasonCodes: ["qa_test_failed"] }),
      d,
    );
    expect(r.ok).toBe(true);
    const rejDec = decodeFunctionData({ abi: ERC8183_ABI,
      data: d.sent[1].data });
    expect(rejDec.functionName).toBe("reject");
    expect(rejDec.args[1]).toBe(verdictMemoId("b1", 1, SHA));
  });

  it("idempotent: outcome with verdictMemoTx → skipped, zero txs", async () => {
    upsertBounty(bounty());
    const anchored = outcome({ verdictMemoTx: "0xmemotx" });
    putOutcome(anchored);
    const d = deps();
    const r = await anchorBountyOutcome(bounty(), anchored, d);
    expect(r.ok).toBe(true);
    expect(r.skipped).toBe(true);
    expect(r.memoTxHash).toBe("0xmemotx");
    expect(d.sent).toHaveLength(0);
  });

  it("no onchainJobId → anchor only, no action tx", async () => {
    upsertBounty(bounty({ onchainJobId: undefined }));
    putOutcome(outcome());
    const d = deps();
    const r = await anchorBountyOutcome(
      bounty({ onchainJobId: undefined }), outcome(), d);
    expect(r.ok).toBe(true);
    expect(d.sent).toHaveLength(1);
    expect(r.actionTxHash).toBeUndefined();
  });

  it("send failure → ok:false, outcome untouched", async () => {
    upsertBounty(bounty());
    putOutcome(outcome());
    const r = await anchorBountyOutcome(bounty(), outcome(), {
      network: net,
      send: () => Promise.resolve(null),
    });
    expect(r.ok).toBe(false);
    expect(getOutcome("b1", 1)!.verdictMemoTx).toBeUndefined();
  });
});

describe("anchorSweep", () => {
  it("disabled by default", async () => {
    upsertBounty(bounty());
    putOutcome(outcome());
    delete process.env.BOUNTY_QA_RUNNER_ENABLED;
    const r = await anchorSweep({ network: net });
    expect(r.disabled).toBe(true);
    expect(r.anchored).toBe(0);
  });

  it("sweep anchors pending outcomes only", async () => {
    upsertBounty(bounty());
    upsertBounty(bounty({ bountyId: "b2", status: "failed",
      jobAttempt: 3 }));
    putOutcome(outcome());
    putOutcome(outcome({ id: "b2:3", bountyId: "b2", jobAttempt: 3,
      verdict: "fail" }));
    const d = deps();
    const r = await anchorSweep({ ...d, enabled: true });
    expect(r.anchored).toBe(2);
    expect(getOutcome("b1", 1)!.verdictMemoTx).toBeTruthy();
    expect(getOutcome("b2", 3)!.verdictMemoTx).toBeTruthy();
    // Re-run → nothing pending.
    const again = await anchorSweep({ ...deps(), enabled: true });
    expect(again.anchored).toBe(0);
  });
});

describe("encodeVerdictMemo / verdictMemoId", () => {
  it("memoId deterministic; memoData round-trips fields", () => {
    const a = verdictMemoId("b1", 1, SHA);
    const b = verdictMemoId("b1", 1, SHA);
    const c = verdictMemoId("b1", 2, SHA);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    const data = encodeVerdictMemo({
      bountyId: "b1", jobId: 42n, verdict: "fail", commitSha: SHA,
      reasonCodes: ["qa_test_failed"], runnerLogHash: `0x${"0".repeat(64)}`,
    });
    expect(data.startsWith("0x")).toBe(true);
  });
});
