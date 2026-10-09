/**
 * SLICE-172-5: tamper detection + inclusion recompute (offline).
 * Mutate the JSON chain store → verifyChain invalid; REST proof fold
 * contradicts the last anchored headHash. Entry artifactHash ==
 * hashCanonical(artifact) — same value the per-verdict memo carries.
 */
import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync, writeFileSync } from "node:fs";
import { Wallet } from "ethers";
import type { Hex } from "viem";
import { computeEntryHash } from "@agentbadge/circle-payments";
import type { ChainEntry } from "@agentbadge/circle-payments";
import { createVerdictSigner } from "../src/server/lib/eaas/verdict";
import { createJsonVerdictStore } from "../src/server/lib/eaas/store";
import { createMemoryRequestStore } from "../src/server/lib/eaas/requests";
import { createEaasMetrics } from "../src/server/lib/eaas/metrics";
import { createJsonChainStore, createChainService } from "../src/server/lib/eaas/chain";
import { createChainFlusher } from "../src/server/lib/eaas/chain-flush";
import { createEaasFeedsRoutes } from "../src/server/routes/eaas-feeds-api";
import { issueVerdict } from "../src/server/lib/eaas/index";
import { artifactHashOf } from "../src/server/lib/eaas/anchor";

const signer = createVerdictSigner(Wallet.createRandom().privateKey, 5042002);
const REQ = { policy: "deliverable-present", deliverable: { x: 1 } };

interface FileShape { entries: ChainEntry[]; head?: unknown }
const tamper = (file: string, fn: (f: FileShape) => void) => {
  const f = JSON.parse(readFileSync(file, "utf8")) as FileShape;
  fn(f);
  writeFileSync(file, JSON.stringify(f));
};

async function seeded(n = 3) {
  const dir = mkdtempSync(join(tmpdir(), "eaas-tamper-"));
  const verdicts = createJsonVerdictStore(join(dir, "v.json"));
  const chainFile = join(dir, "chain.json");
  const store = createJsonChainStore(chainFile);
  const service = createChainService({ store });
  const ids: Hex[] = [];
  for (let i = 0; i < n; i++) {
    const r = await issueVerdict({ ...REQ, nonce: i }, { signer, store: verdicts, chain: service });
    ids.push(r.artifact.verdictId);
  }
  // anchor the good head through the real flusher path
  const clock = 1_000_000;
  const q: (() => void)[] = [];
  const flusher = createChainFlusher({
    service, store,
    memo: "0x9999999999999999999999999999999999999999",
    selfAddress: "0x2222222222222222222222222222222222222222",
    send: async () => ({ txHash: `0x${"aa".repeat(32)}` as Hex, blockNumber: 7n }),
    flushMs: 60_000, retries: 1, backoffMs: 1,
    schedule: (fn) => void q.push(fn),
    now: () => clock,
  });
  flusher.start();
  for (const fn of q.splice(0)) { fn(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); }
  const anchoredHash = (store.head() as { lastAnchoredHash?: Hex }).lastAnchoredHash!;
  const app = new Hono().route("/", createEaasFeedsRoutes({
    store: verdicts,
    requests: createMemoryRequestStore(),
    metrics: createEaasMetrics(),
    rateRpm: 60,
    chain: service, chainId: 5042002,
  }));
  return { verdicts, store, service, chainFile, anchoredHash, app, ids };
}

describe("chain tamper detection", () => {
  it("edit an artifactHash → verifyChain broken at that seq", async () => {
    const s = await seeded();
    tamper(s.chainFile, (f) => {
      f.entries[1] = { ...f.entries[1]!, artifactHash: `0x${"ff".repeat(32)}` as Hex };
    });
    const v = s.service.verify();
    expect(v.ok).toBe(false);
    expect(v.firstBrokenSeq).toBe(1);
  });

  it("delete first entry → linkage breaks at seq 1", async () => {
    const s = await seeded();
    tamper(s.chainFile, (f) => { f.entries.splice(0, 1); });
    const v = s.service.verify();
    expect(v.ok).toBe(false);
    expect(v.firstBrokenSeq).toBe(1); // old[1].seq=1 at index 0 → seq mismatch
  });

  it("insert bogus entry → linkage breaks at insert position", async () => {
    const s = await seeded();
    tamper(s.chainFile, (f) => {
      f.entries.splice(1, 0, {
        seq: 1, domain: "eaas-verdicts",
        verdictId: `0x${"cc".repeat(32)}` as Hex,
        prevHash: `0x${"00".repeat(32)}` as Hex, // wrong link
        artifactHash: `0x${"dd".repeat(32)}` as Hex,
        entryHash: `0x${"ee".repeat(32)}` as Hex,
        appendedAt: 0,
      });
    });
    const v = s.service.verify();
    expect(v.ok).toBe(false);
    expect(v.firstBrokenSeq).toBe(1);
  });

  it("REST: proof fold after tamper contradicts the anchored headHash", async () => {
    const s = await seeded();
    // sanity: head endpoint reports chainOk before tamper
    const before = await (await s.app.request("/api/eaas/chain")).json();
    expect(before.chainOk).toBe(true);
    expect(before.anchor.epochSeq).toBe(0);

    tamper(s.chainFile, (f) => {
      f.entries[0] = { ...f.entries[0]!, artifactHash: `0x${"11".repeat(32)}` as Hex };
    });
    const after = await (await s.app.request("/api/eaas/chain")).json();
    expect(after.chainOk).toBe(false); // contradiction visible at head level

    const proof = await (await s.app.request(`/api/eaas/chain/proof/${s.ids[0]}`)).json();
    let h = proof.path[0].prevHash as Hex;
    for (const e of proof.path) h = computeEntryHash(h, e.artifactHash as Hex);
    expect(h).not.toBe(s.anchoredHash); // folded ≠ anchored → tamper proven
  });

  it("inclusion-e2e: entry artifactHash == hashCanonical(artifact) (per-verdict memoData)", async () => {
    const s = await seeded();
    const proof = await (await s.app.request(`/api/eaas/chain/proof/${s.ids[0]}`)).json();
    const stored = s.verdicts.get(s.ids[0])!;
    expect(proof.path[0].artifactHash).toBe(artifactHashOf(stored.artifact));
  });
});
