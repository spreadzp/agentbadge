#!/usr/bin/env bun
/**
 * SLICE-172-5: verdict hash-chain dogfood — live head-anchor on Arc testnet.
 *
 *   1. 3 paid verdicts via examples/eaas-client.ts (x402 self-settle)
 *   2. GET /api/eaas/chain          — head + count after appends
 *   3. FORCE FLUSH — a real createChainFlusher over the server's chain file
 *      (flushMs=0 → tick() anchors immediately): memo(self,0x,
 *      memoIdFor("chain","eaas-verdicts",epoch), abiEncode(head,count,prev))
 *   4. getLogs(Memo, memoId)        — AC2: event visible, memoId correct
 *   5. GET /api/eaas/chain/proof/:id — print proof + recompute headHash
 *
 * Env:
 *   ENDPOINT     — server base URL (default http://localhost:4021)
 *   CHAIN_KEY    — 0x-privkey, the flush sender (default ARC_EVALUATOR_KEY/
 *                  DEPLOYER_PRIVATE_KEY — must match the server's EOA)
 *   CHAIN_FILE   — chain JSON (default .data/eaas-chain.json, the server's)
 *   ARC_RPC_URL  — override (default ARC_TESTNET.rpcUrl)
 *   VERDICTS     — how many paid verdicts to issue (default 3)
 */
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  ARC_CONTRACTS,
  ARC_TESTNET,
  MEMO_ABI,
  memoIdFor,
  computeEntryHash,
} from "@agentbadge/circle-payments";
import {
  createJsonChainStore,
  createChainService,
  VERDICT_CHAIN_DOMAIN,
} from "../src/server/lib/eaas/chain";
import { createChainFlusher } from "../src/server/lib/eaas/chain-flush";

const ENDPOINT = process.env.ENDPOINT ?? "http://localhost:4021";
const CHAIN_FILE = process.env.CHAIN_FILE ?? ".data/eaas-chain.json";
const RPC = process.env.ARC_RPC_URL ?? ARC_TESTNET.rpcUrl;
const MEMO = ARC_CONTRACTS.memo as `0x${string}`;
const N = Number(process.env.VERDICTS ?? 3);

const key = (process.env.CHAIN_KEY ??
  process.env.ARC_EVALUATOR_KEY ??
  process.env.DEPLOYER_PRIVATE_KEY) as `0x${string}` | undefined;
if (!key) {
  console.error("CHAIN_KEY (or ARC_EVALUATOR_KEY/DEPLOYER_PRIVATE_KEY) required");
  process.exit(1);
}
const account = privateKeyToAccount(key);
const viemChain = defineChain({
  id: ARC_TESTNET.chainId,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 6 },
  rpcUrls: { default: { http: [RPC] } },
});
const read = createPublicClient({ chain: viemChain, transport: http(RPC) });
const wallet = createWalletClient({ account, chain: viemChain, transport: http(RPC) });
const explorerTx = (tx: string) => `${ARC_TESTNET.explorerUrl}/tx/${tx}`;

console.log(`=== eaas-chain dogfood @ ${ENDPOINT} ===`);

// ── [1] paid verdicts ───────────────────────────────────────────────
const ids: string[] = [];
for (let i = 0; i < N; i++) {
  const r = spawnSync(
    "bun",
    ["run", "examples/eaas-client.ts", "--endpoint", ENDPOINT,
      "--policy", "deliverable-present"],
    { encoding: "utf8", maxBuffer: 4 << 20 },
  );
  const id = /verdicts\/(0x[0-9a-f]{64})/.exec(r.stdout)?.[1];
  if (!id) {
    console.error(`[1.${i}] no verdictId — payment failed?\n${r.stdout.slice(-400)}${r.stderr.slice(-400)}`);
    process.exit(1);
  }
  ids.push(id);
  console.log(`[1.${i}] verdict ${id.slice(0, 14)}…`);
}

// ── [2] chain head ──────────────────────────────────────────────────
const headRes = await fetch(`${ENDPOINT}/api/eaas/chain`).then((r) => r.json());
console.log(`[2] head: count=${headRes.count} headHash=${headRes.headHash?.slice(0, 18)}… chainOk=${headRes.chainOk}`);

// ── [3] force flush — real flusher over the server's chain file ─────
const store = createJsonChainStore(resolve(CHAIN_FILE));
const service = createChainService({ store });
const flusher = createChainFlusher({
  service,
  store,
  memo: MEMO,
  selfAddress: account.address,
  send: async ({ to, data }) => {
    const txHash = await wallet.sendTransaction({ account, to, data, chain: viemChain });
    const receipt = await read.waitForTransactionReceipt({ hash: txHash });
    if (receipt.status !== "success") throw new Error("flush tx reverted");
    return { txHash, blockNumber: receipt.blockNumber };
  },
  flushMs: 0,          // every tick() fires — the "force"
  retries: 2,
  backoffMs: 2_000,
});
flusher.start();       // schedules tick at 0 — run it via a macrotask hop
await new Promise((r) => setTimeout(r, 50));
await new Promise((r) => setTimeout(r, 15_000)); // receipt wait budget

const head = store.head()!;
if (!head.anchor) {
  console.error("[3] flush did not anchor — see server/flusher logs");
  process.exit(1);
}
console.log(`[3] anchored epoch=${head.anchor.epochSeq} tx=${head.anchor.txHash}`);
console.log(`    ${explorerTx(head.anchor.txHash)}`);

// ── [4] AC2: Memo event visible, memoId correct ─────────────────────
const expectedMemoId = memoIdFor(
  "chain",
  VERDICT_CHAIN_DOMAIN,
  BigInt(head.anchor.epochSeq),
);
const logs = await read.getLogs({
  address: MEMO,
  event: MEMO_ABI[2],
  args: { memoId: expectedMemoId },
});
if (!logs.length) {
  console.error(`[4] no Memo event for memoId ${expectedMemoId} — FAIL`);
  process.exit(1);
}
console.log(`[4] Memo event ok — memoId ${expectedMemoId.slice(0, 18)}… block ${logs[0]!.blockNumber}`);

// ── [5] proof structure + offline recompute ─────────────────────────
const proof = await fetch(
  `${ENDPOINT}/api/eaas/chain/proof/${ids[0]}`,
).then((r) => r.json());
let folded = proof.path[0].prevHash as Hex;
for (const e of proof.path) folded = computeEntryHash(folded, e.artifactHash);
console.log(`[5] proof seq=${proof.seq} pathLen=${proof.path.length}`);
console.log(`    folded head = ${folded.slice(0, 18)}… ${folded === proof.head.headHash ? "✓ matches" : "✗ MISMATCH"}`);
console.log("=== dogfood done ===");
