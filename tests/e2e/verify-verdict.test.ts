/**
 * SLICE-180-4: end-to-end — issue verdict (EaaS) → anchor →
 * Level-1 endpoint → Level-2 standalone package verifyVerdict.
 *
 * The package is imported via relative path (it is a separate repo —
 * not a server dependency); its VerdictReadClient is mocked with
 * fixtures derived from the SAME anchor data the server seeded, so
 * both layers agree unless tampered.
 */
import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Wallet } from "ethers";
import type { Hex } from "viem";
import { memoIdFor } from "@agentbadge/circle-payments";
import { encodeAbiParameters } from "viem";

import { createVerdictSigner } from "../../src/server/lib/eaas/verdict";
import { createJsonVerdictStore } from "../../src/server/lib/eaas/store";
import { issueVerdict } from "../../src/server/lib/eaas/index";
import {
  artifactHashOf,
  createMemoryAnchorStore,
  verdictMemoId,
} from "../../src/server/lib/eaas/anchor";
import {
  createChainService,
  createMemoryChainStore,
} from "../../src/server/lib/eaas/chain";
import { createVerifyRoutes } from "../../src/server/routes/verify-api";

// Level-2 package — relative import (separate repo, no server dep).
import { verifyVerdict } from "../../../../packages/verify-verdict/src/verify.js";
import type { VerdictReadClient } from "../../../../packages/verify-verdict/src/chain-read.js";

const CHAIN_ID = 5042002;
const signer = createVerdictSigner(Wallet.createRandom().privateKey, CHAIN_ID);
const REQ = { policy: "deliverable-present", deliverable: { x: 1 } };
const ANCHOR_TX =
  "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef" as Hex;
const HEAD_TX =
  "0x1111111111111111111111111111111111111111111111111111111111111111" as Hex;
const DOMAIN = "eaas-verdicts";

function headData(headHash: Hex, count: number, prev: Hex): Hex {
  return encodeAbiParameters(
    [
      { name: "headHash", type: "bytes32" },
      { name: "count", type: "uint256" },
      { name: "prevAnchoredHeadHash", type: "bytes32" },
    ],
    [headHash, BigInt(count), prev],
  );
}

async function e2eSeed() {
  const dir = mkdtempSync(join(tmpdir(), "e2e-verify-"));
  const store = createJsonVerdictStore(join(dir, "v.json"));
  const chainStore = createMemoryChainStore();
  const chain = createChainService({ store: chainStore });
  const issued = await issueVerdict(
    { ...REQ, nonce: 3 },
    { signer, store, chain },
  );
  const verdictId = issued.artifact.verdictId;
  const anchors = createMemoryAnchorStore();
  const app = new Hono().route(
    "/",
    createVerifyRoutes({
      store,
      rateRpm: 60,
      anchors,
      ...(chain ? { chain, chainId: CHAIN_ID } : {}),
      explorerTx: (t) => `https://arc.test/tx/${t}`,
    }),
  );
  return { app, store, chain, chainStore, anchors, verdictId, artifact: issued.artifact };
}

/** Mock chain read serving the same memoData the anchorer would put. */
function readFromSeeds(memos: Record<string, Hex>): VerdictReadClient {
  return {
    async getLogs({ args }: { args: { memoId: Hex } }) {
      const memoData = memos[args.memoId.toLowerCase()];
      if (!memoData) return [];
      return [
        { transactionHash: ANCHOR_TX, blockNumber: 55n, args: { memo: memoData, memoIndex: 0n } },
      ];
    },
    async getBlock() {
      return { timestamp: 1700000000n };
    },
    async getTransactionReceipt() {
      return { status: "success" as const, logs: [] };
    },
  };
}

describe("e2e: issue → anchor → level-1 → level-2", () => {
  it("anchored verdict is valid at both levels", async () => {
    const s = await e2eSeed();
    const artifactHash = artifactHashOf(s.artifact);

    // Anchor landed (fire-and-forget completed) + head anchor epoch 0 —
    // the flusher path: store head carries its anchor record.
    s.anchors.put({
      verdictId: s.verdictId,
      memoId: verdictMemoId(s.verdictId),
      artifactHash,
      status: "anchored",
      attempts: 1,
      txHash: ANCHOR_TX,
      blockNumber: "55",
    });
    const head = s.chain.head();
    s.chainStore.putHead({
      ...head,
      anchor: { epochSeq: 0, txHash: HEAD_TX, blockNumber: "77" },
    });
    const memos = {
      [verdictMemoId(s.verdictId).toLowerCase()]: artifactHash,
      [memoIdFor("chain", DOMAIN, 0n).toLowerCase()]: headData(
        head.headHash,
        head.count,
        `0x${"00".repeat(32)}`,
      ),
    };

    // Level-1: our endpoint.
    const r = await s.app.request(`/api/verify/${s.verdictId}`);
    expect(r.status).toBe(200);
    const l1 = await r.json();
    expect(l1.anchor.status).toBe("anchored");
    expect(l1.anchor.txHash).toBe(ANCHOR_TX);
    expect(l1.chain.status).toBe("server-reported");

    // Level-2: independent package, mock-RPC seeded from same data.
    const l2 = await verifyVerdict({
      verdictId: s.verdictId,
      artifact: s.artifact,
      entries: s.chain.entries(),
      headEpochs: [0],
      read: readFromSeeds(memos),
    });
    expect(l2.valid).toBe(true);
    expect(l2.proofs.map((p) => p.kind)).toEqual([
      "verdict",
      "anchor-head",
      "chain-recompute",
    ]);
    expect(l2.headAnchor?.epochSeq).toBe(0);
  });

  it("tampered entry → level-2 fails with firstBrokenSeq", async () => {
    const s = await e2eSeed();
    const artifactHash = artifactHashOf(s.artifact);
    s.anchors.put({
      verdictId: s.verdictId,
      memoId: verdictMemoId(s.verdictId),
      artifactHash,
      status: "anchored",
      attempts: 1,
      txHash: ANCHOR_TX,
      blockNumber: "55",
    });
    const tampered = s.chain
      .entries()
      .map((e) => ({ ...e, artifactHash: `0x${"ff".repeat(32)}` as Hex }));

    const l2 = await verifyVerdict({
      verdictId: s.verdictId,
      entries: tampered,
      headEpochs: "none",
      read: readFromSeeds({
        [verdictMemoId(s.verdictId).toLowerCase()]: artifactHash,
      }),
    });
    expect(l2.valid).toBe(false);
    const re = l2.proofs.find((p) => p.kind === "chain-recompute")!;
    expect(re.ok).toBe(false);
    expect(re.detail.firstBrokenSeq).toBe(0);
  });

  it("pending anchor → level-1 honest pending, level-2 honest fail", async () => {
    const s = await e2eSeed();
    s.anchors.put({
      verdictId: s.verdictId,
      memoId: verdictMemoId(s.verdictId),
      artifactHash: artifactHashOf(s.artifact),
      status: "pending",
      attempts: 1,
    });

    const r = await s.app.request(`/api/verify/${s.verdictId}`);
    const l1 = await r.json();
    expect(l1.anchor.status).toBe("pending");

    const l2 = await verifyVerdict({
      verdictId: s.verdictId,
      headEpochs: "none",
      read: readFromSeeds({}), // nothing on-chain yet
    });
    expect(l2.valid).toBe(false);
    expect(l2.proofs[0]).toMatchObject({ kind: "verdict", ok: false });
  });
});
