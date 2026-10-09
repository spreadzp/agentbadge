/**
 * SLICE-172-3: chain head-anchor flusher — window + heartbeat semantics.
 * Fake scheduler + clock: no real timers, no chain. Covers fresh-head
 * anchor, empty-window heartbeat (same headHash, epochSeq+1), missed-
 * window catch-up after "restart", no-op inside a live window, retry.
 */
import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Wallet } from "ethers";
import type { Hex } from "viem";
import { decodeFunctionData, decodeAbiParameters, keccak256, toBytes } from "viem";
import { MEMO_ABI, memoIdFor } from "@agentbadge/circle-payments";
import { createVerdictSigner } from "../src/server/lib/eaas/verdict";
import { createJsonVerdictStore } from "../src/server/lib/eaas/store";
import {
  createChainService,
  createJsonChainStore,
  VERDICT_CHAIN_DOMAIN,
} from "../src/server/lib/eaas/chain";
import { createChainFlusher } from "../src/server/lib/eaas/chain-flush";
import { issueVerdict } from "../src/server/lib/eaas/index";

const CHAIN_ID = 5042002;
const signer = createVerdictSigner(Wallet.createRandom().privateKey, CHAIN_ID);
const MEMO = "0x9999999999999999999999999999999999999999" as const;
const SELF = "0x2222222222222222222222222222222222222222" as const;
const REQ = { policy: "deliverable-present", deliverable: { x: 1 } };

const FLUSH_MS = 60_000;

function sched() {
  const q: { fn: () => void; ms: number }[] = [];
  return {
    q,
    schedule: (fn: () => void, ms: number) => void q.push({ fn, ms }),
    // Run only the CURRENTLY queued timers — tick() reschedules itself, so
    // draining until empty would never terminate (self-perpetuating queue).
    async flush() {
      for (const t of q.splice(0)) {
        t.fn();
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      }
    },
  };
}

function setup(send: (tx: { to: `0x${string}`; data: Hex }) => Promise<{ txHash: Hex; blockNumber: bigint }>, t0 = 1_000_000) {
  const dir = mkdtempSync(join(tmpdir(), "eaas-flush-"));
  const verdicts = createJsonVerdictStore(join(dir, "v.json"));
  const chainFile = join(dir, "chain.json");
  const store = createJsonChainStore(chainFile);
  const service = createChainService({ store });
  const timer = sched();
  let clock = t0;
  const flusher = createChainFlusher({
    service,
    store,
    memo: MEMO,
    selfAddress: SELF,
    send,
    flushMs: FLUSH_MS,
    retries: 3,
    backoffMs: 1_000,
    schedule: timer.schedule,
    now: () => clock,
  });
  return { verdicts, store, service, timer, flusher, setClock: (t: number) => { clock = t; } };
}

async function seed(s: ReturnType<typeof setup>, nonce: number) {
  await issueVerdict({ ...REQ, nonce }, { signer, store: s.verdicts, chain: s.service });
}

function decodeSent(data: Hex) {
  const { functionName, args } = decodeFunctionData({ abi: MEMO_ABI, data });
  const a = args as readonly Hex[];
  const [headHash, count, prev] = decodeAbiParameters(
    [
      { type: "bytes32" },
      { type: "uint256" },
      { type: "bytes32" },
    ],
    a[3]!,
  );
  return { functionName, memoId: a[2]!, headHash, count, prev };
}

describe("chain flusher", () => {
  it("tick past window with new entries → anchors head (epochSeq 0)", async () => {
    const sent: { to: string; data: Hex }[] = [];
    const s = setup(async (tx) => {
      sent.push(tx);
      return { txHash: ("0x" + "aa".repeat(32)) as Hex, blockNumber: 7n };
    });
    await seed(s, 1);
    await seed(s, 2);
    s.flusher.start();
    await s.timer.flush();

    expect(sent).toHaveLength(1);
    const d = decodeSent(sent[0]!.data);
    expect(d.functionName).toBe("memo");
    expect(d.memoId).toBe(memoIdFor("chain", VERDICT_CHAIN_DOMAIN, 0n));
    expect(d.headHash).toBe(s.service.head().headHash);
    expect(d.count).toBe(2n);
    const head = s.store.head()!;
    expect(head.anchor!.epochSeq).toBe(0);
    expect(head.lastFlushAt).toBe(1_000_000);
  });

  it("empty window → heartbeat: same headHash re-anchored, epochSeq+1", async () => {
    const sent: Hex[] = [];
    const s = setup(async (tx) => {
      sent.push(tx.data);
      return { txHash: ("0x" + "bb".repeat(32)) as Hex, blockNumber: 9n };
    });
    await seed(s, 1);
    s.flusher.start();
    await s.timer.flush();
    expect(sent).toHaveLength(1);

    // advance past the next window with NO new entries
    s.setClock(1_000_000 + FLUSH_MS + 1);
    await s.timer.flush();
    expect(sent).toHaveLength(2);
    const d1 = decodeSent(sent[0]!);
    const d2 = decodeSent(sent[1]!);
    expect(d2.headHash).toBe(d1.headHash);
    expect(d2.memoId).toBe(memoIdFor("chain", VERDICT_CHAIN_DOMAIN, 1n));
    expect(d2.memoId).not.toBe(d1.memoId);
    // prevAnchoredHash cites the epoch-0 anchored head
    expect(d2.prev).toBe(d1.headHash);
    expect(s.store.head()!.anchor!.epochSeq).toBe(1);
  });

  it("missed window after restart → immediate catch-up flush", async () => {
    const sent: string[] = [];
    const s = setup(async (tx) => {
      sent.push(tx.data);
      return { txHash: ("0x" + "cc".repeat(32)) as Hex, blockNumber: 3n };
    }, 10_000_000);
    // stale lastFlushAt: last flush was long ago
    s.store.putHead({ ...s.service.head(), lastFlushAt: 0 });
    s.flusher.start();
    // start() must schedule the catch-up at ~0ms, not flushMs
    expect(s.timer.q[0]!.ms).toBe(0);
    await s.timer.flush();
    expect(sent).toHaveLength(1);
  });

  it("tick inside a live window → no send", async () => {
    const sent: string[] = [];
    const s = setup(async (tx) => {
      sent.push(tx.data);
      return { txHash: ("0x" + "dd".repeat(32)) as Hex, blockNumber: 1n };
    });
    await seed(s, 1);
    s.flusher.start();
    await s.timer.flush();
    expect(sent).toHaveLength(1);
    // only 30s into the next window → tick reschedules, no send
    s.setClock(1_000_000 + 30_000);
    await s.timer.flush();
    expect(sent).toHaveLength(1);
  });

  it("send failure → backoff retry, then success", async () => {
    let calls = 0;
    const s = setup(async () => {
      calls++;
      if (calls === 1) throw new Error("rpc down");
      return { txHash: ("0x" + "ee".repeat(32)) as Hex, blockNumber: 5n };
    });
    await seed(s, 1);
    s.flusher.start();
    await s.timer.flush(); // tick → attempt fails → backoff retry scheduled
    await s.timer.flush(); // retry → success
    expect(calls).toBe(2); // 1 fail + 1 retry
    expect(s.store.head()!.anchor!.epochSeq).toBe(0);
  });

  it("memoId lands in the chain namespace — distinct from eaas per-verdict ids", async () => {
    const sent: Hex[] = [];
    const s = setup(async (tx) => {
      sent.push(tx.data);
      return { txHash: ("0x" + "ff".repeat(32)) as Hex, blockNumber: 1n };
    });
    s.flusher.start();
    await s.timer.flush();
    const d = decodeSent(sent[0]!);
    const chainNs = memoIdFor("chain", VERDICT_CHAIN_DOMAIN, 0n);
    const verdictNs = memoIdFor("eaas", 0n);
    expect(d.memoId).toBe(chainNs);
    expect(d.memoId).not.toBe(verdictNs);
    expect(chainNs).not.toBe(keccak256(toBytes("eaas:0")));
  });
});
