/**
 * SLICE-172-2: verdict hash-chain — server store + append-hook tests.
 * Covers: one entry per verdict, idempotent append (duplicate replays,
 * retried persists), restart recovery via JSON store reload, seq order,
 * proofFor suffix, chain off when dep absent (154-4 behavior unchanged).
 */
import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Wallet } from "ethers";
import type { Hex } from "viem";
import { createVerdictSigner } from "../src/server/lib/eaas/verdict";
import { createJsonVerdictStore } from "../src/server/lib/eaas/store";
import {
  createChainService,
  createJsonChainStore,
  createMemoryChainStore,
  VERDICT_CHAIN_DOMAIN,
} from "../src/server/lib/eaas/chain";
import { issueVerdict } from "../src/server/lib/eaas/index";
import { artifactHashOf } from "../src/server/lib/eaas/anchor";
import {
  GENESIS_HASH,
  computeEntryHash,
  verifyChain,
} from "@agentbadge/circle-payments";

const CHAIN_ID = 5042002;
const SIGNER_KEY = Wallet.createRandom().privateKey;
const signer = createVerdictSigner(SIGNER_KEY, CHAIN_ID);

const REQ = {
  policy: "deliverable-present",
  deliverable: { data: { x: 1 } },
} as const;

describe("chain append via issueVerdict", () => {
  it("each new verdict = exactly one chain entry", async () => {
    const dir = mkdtempSync(join(tmpdir(), "eaas-chain-"));
    const verdicts = createJsonVerdictStore(join(dir, "v.json"));
    const chain = createChainService({ store: createMemoryChainStore() });
    const deps = { signer, store: verdicts, chain };

    const r1 = await issueVerdict({ ...REQ, nonce: 1 }, deps);
    const r2 = await issueVerdict({ ...REQ, nonce: 2 }, deps);

    const entries = chain.entries();
    expect(entries).toHaveLength(2);
    expect(entries[0]!.verdictId).toBe(r1.artifact.verdictId);
    expect(entries[1]!.verdictId).toBe(r2.artifact.verdictId);
    expect(entries[0]!.seq).toBe(0);
    expect(entries[0]!.prevHash).toBe(GENESIS_HASH);
    expect(entries[1]!.prevHash).toBe(entries[0]!.entryHash);
    expect(chain.head().count).toBe(2);
    expect(chain.head().domain).toBe(VERDICT_CHAIN_DOMAIN);
    expect(chain.verify().ok).toBe(true);
  });

  it("entry artifactHash == per-verdict anchor hash (hashCanonical)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "eaas-chain-"));
    const verdicts = createJsonVerdictStore(join(dir, "v.json"));
    const chain = createChainService({ store: createMemoryChainStore() });
    const r = await issueVerdict(REQ, { signer, store: verdicts, chain });
    const e = chain.entries()[0]!;
    expect(e.artifactHash).toBe(artifactHashOf(r.artifact));
    expect(e.entryHash).toBe(
      computeEntryHash(GENESIS_HASH, artifactHashOf(r.artifact)),
    );
  });

  it("duplicate issueVerdict replay does NOT double-append", async () => {
    const dir = mkdtempSync(join(tmpdir(), "eaas-chain-"));
    const verdicts = createJsonVerdictStore(join(dir, "v.json"));
    const chain = createChainService({ store: createMemoryChainStore() });
    const deps = { signer, store: verdicts, chain };

    const r1 = await issueVerdict(REQ, deps);
    const r2 = await issueVerdict(REQ, deps); // same payload → duplicate
    expect(r2.duplicate).toBe(true);
    expect(chain.entries()).toHaveLength(1);
    expect(chain.entries()[0]!.verdictId).toBe(r1.artifact.verdictId);
  });

  it("service-level append is idempotent by verdictId (store retry)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "eaas-chain-"));
    const verdicts = createJsonVerdictStore(join(dir, "v.json"));
    const chain = createChainService({ store: createMemoryChainStore() });
    const r = await issueVerdict(REQ, { signer, store: verdicts });
    const stored = verdicts.get(r.artifact.verdictId)!;
    const e1 = chain.append(stored);
    const e2 = chain.append(stored); // retried persist
    expect(e1.entryHash).toBe(e2.entryHash);
    expect(chain.entries()).toHaveLength(1);
  });

  it("no chain dep → issueVerdict unchanged (ARC_CHAIN_ENABLED=0 path)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "eaas-chain-"));
    const verdicts = createJsonVerdictStore(join(dir, "v.json"));
    const r = await issueVerdict(REQ, { signer, store: verdicts });
    expect(r.duplicate).toBe(false);
    expect(verdicts.get(r.artifact.verdictId)).toBeDefined();
  });
});

describe("json chain store", () => {
  it("survives restart: reload → entries + head intact, verifyChain ok", async () => {
    const dir = mkdtempSync(join(tmpdir(), "eaas-chain-"));
    const file = join(dir, "chain.json");
    const verdicts = createJsonVerdictStore(join(dir, "v.json"));
    const c1 = createChainService({ store: createJsonChainStore(file) });
    await issueVerdict({ ...REQ, nonce: 1 }, { signer, store: verdicts, chain: c1 });
    await issueVerdict({ ...REQ, nonce: 2 }, { signer, store: verdicts, chain: c1 });

    // "restart": new store + service over the same file
    const c2 = createChainService({ store: createJsonChainStore(file) });
    expect(c2.entries()).toHaveLength(2);
    expect(c2.head().count).toBe(2);
    expect(c2.head().headHash).toBe(c2.entries()[1]!.entryHash);
    expect(c2.verify().ok).toBe(true);

    // appends continue correctly after reload
    await issueVerdict({ ...REQ, nonce: 3 }, { signer, store: verdicts, chain: c2 });
    expect(c2.entries()).toHaveLength(3);
    expect(c2.entries()[2]!.prevHash).toBe(c2.entries()[1]!.entryHash);
    expect(verifyChain(c2.entries()).ok).toBe(true);
  });

  it("missing file → empty chain, genesis head", () => {
    const c = createChainService({
      store: createJsonChainStore(join(tmpdir(), "nope-chain.json")),
    });
    expect(c.entries()).toEqual([]);
    expect(c.head().headHash).toBe(GENESIS_HASH);
    expect(c.head().count).toBe(0);
  });

  it("entries(from,to) slices + proofFor returns self-sufficient suffix", async () => {
    const dir = mkdtempSync(join(tmpdir(), "eaas-chain-"));
    const verdicts = createJsonVerdictStore(join(dir, "v.json"));
    const chain = createChainService({ store: createMemoryChainStore() });
    const deps = { signer, store: verdicts, chain };
    const r1 = await issueVerdict({ ...REQ, nonce: 1 }, deps);
    await issueVerdict({ ...REQ, nonce: 2 }, deps);
    await issueVerdict({ ...REQ, nonce: 3 }, deps);

    expect(chain.entries(1, 3)).toHaveLength(2);
    const proof = chain.proofFor(r1.artifact.verdictId)!;
    expect(proof.entry.seq).toBe(0);
    expect(proof.path).toHaveLength(3); // seq0 entry + suffix to head
    // offline recompute: fold artifactHashes over the suffix
    let h = proof.path[0]!.prevHash;
    for (const e of proof.path) h = computeEntryHash(h, e.artifactHash);
    expect(h).toBe(chain.head().headHash);
    expect(chain.proofFor("0x" + "ab".repeat(32) as Hex)).toBeUndefined();
  });
});
