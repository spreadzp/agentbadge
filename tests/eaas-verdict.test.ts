/**
 * SLICE-154-1 tests: EIP-712 round-trip, tamper detection, verdictId
 * idempotency, policy packs (scanner injected, no module mocks), and
 * json/sqlite store parity.
 *
 * The sqlite backend requires bun:sqlite — run `bun test tests/eaas-verdict.test.ts`
 * for full coverage; under node vitest those cases skip gracefully.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Wallet } from "ethers";
import type { Hex } from "viem";

import {
  buildVerdictDomain,
  canonicalJson,
  createVerdictSigner,
  hashDeliverable,
  verifyVerdictSignature,
  verdictIdOf,
  type UnsignedVerdictArtifact,
  type VerdictArtifact,
} from "../src/server/lib/eaas/verdict";
import {
  createPolicyRegistry,
  getPolicy,
  UnknownPolicyError,
  withTimeout,
} from "../src/server/lib/eaas/policies";
import {
  createJsonVerdictStore,
  createSqliteVerdictStore,
  type StoredVerdict,
  type VerdictStoreBackend,
} from "../src/server/lib/eaas/store";
import { issueVerdict, type IssueVerdictRequest } from "../src/server/lib/eaas/index";

const CHAIN_ID = 5042002; // Arc testnet
const SIGNER_KEY = Wallet.createRandom().privateKey;
const signer = createVerdictSigner(SIGNER_KEY, CHAIN_ID);

function makeUnsigned(overrides: Partial<UnsignedVerdictArtifact> = {}): UnsignedVerdictArtifact {
  const deliverableHash = hashDeliverable({ url: "https://x.test" });
  return {
    verdictId: verdictIdOf(deliverableHash, "deliverable-present", 0),
    kind: "approve",
    policy: "deliverable-present",
    deliverableHash,
    reason: "ok",
    reasonHash: ("0x" + "11".repeat(32)) as Hex,
    evidenceHash: ("0x" + "22".repeat(32)) as Hex,
    evaluator: signer.address as Hex,
    chainId: CHAIN_ID,
    issuedAt: "2026-10-02T12:00:00.000Z",
    ...overrides,
  };
}

async function sign(unsigned: UnsignedVerdictArtifact): Promise<VerdictArtifact> {
  return { ...unsigned, signature: await signer.sign(unsigned) };
}

describe("EIP-712 verdict signature", () => {
  it("sign → verify round-trip (recover == evaluator)", async () => {
    const artifact = await sign(makeUnsigned());
    expect(verifyVerdictSignature(artifact)).toBe(true);
  });

  it("tampered field → verify false", async () => {
    const artifact = await sign(makeUnsigned());
    const tampered: VerdictArtifact = { ...artifact, reason: "forged" };
    expect(verifyVerdictSignature(tampered)).toBe(false);
  });

  it("garbage signature → verify false (no throw)", async () => {
    const artifact = await sign(makeUnsigned());
    expect(
      verifyVerdictSignature({ ...artifact, signature: "0xdead" }),
    ).toBe(false);
  });

  it("wrong chainId → verify false (domain is chain-bound)", async () => {
    const artifact = await sign(makeUnsigned());
    const moved: VerdictArtifact = { ...artifact, chainId: 5042 };
    expect(verifyVerdictSignature(moved)).toBe(false);
  });

  it("domain shape matches evm-core eip712 convention", () => {
    const d = buildVerdictDomain(CHAIN_ID);
    expect(d.name).toBe("AgentBadgeVerdict");
    expect(d.version).toBe("1");
    expect(d.chainId).toBe(CHAIN_ID);
    expect(d.verifyingContract).toBe(
      "0x0000000000000000000000000000000000000000",
    );
  });
});

describe("canonical hashing + verdictId", () => {
  it("canonicalJson sorts keys recursively", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe(
      '{"a":{"c":3,"d":2},"b":1}',
    );
  });

  it("verdictId is deterministic on (deliverableHash, policy, nonce)", () => {
    const h = hashDeliverable({ x: 1 });
    expect(verdictIdOf(h, "p", 7)).toBe(verdictIdOf(h, "p", 7));
    expect(verdictIdOf(h, "p", 7)).not.toBe(verdictIdOf(h, "p", 8));
    expect(verdictIdOf(h, "p", 7)).not.toBe(verdictIdOf(h, "q", 7));
  });
});

describe("policy packs", () => {
  const registry = createPolicyRegistry({
    scan: async () => ({
      domain: "x.test",
      scannedAt: "2026-10-02T12:00:00.000Z",
      snapshots: { html: { status: 200 } as never, robots: null },
    }),
  });

  it("unknown policy → UnknownPolicyError (400 at route layer)", () => {
    expect(() => getPolicy("nope")).toThrow(UnknownPolicyError);
  });

  it("deliverable-present: pass on payload, fail on nullish", async () => {
    expect(
      (await registry["deliverable-present"]({ deliverable: { a: 1 } })).pass,
    ).toBe(true);
    expect(
      (await registry["deliverable-present"]({ deliverable: null })).pass,
    ).toBe(false);
  });

  it("hash-match: pass on commitment match, fail on mismatch/missing", async () => {
    const expectedHash = hashDeliverable({ k: "v" });
    const pass = await registry["hash-match"]({
      deliverable: { k: "v" },
      expectedHash,
    });
    expect(pass.pass).toBe(true);
    const fail = await registry["hash-match"]({
      deliverable: { k: "v" },
      expectedHash: ("0x" + "ab".repeat(32)) as Hex,
    });
    expect(fail.pass).toBe(false);
    const missing = await registry["hash-match"]({ deliverable: { k: "v" } });
    expect(missing.pass).toBe(false);
    expect(missing.reason).toContain("expectedHash required");
  });

  it("readiness-scan: pass on fetched snapshots, evidence carries scan summary", async () => {
    const r = await registry["readiness-scan"]({
      deliverable: {},
      deliverableUri: "https://x.test",
    });
    expect(r.pass).toBe(true);
    const ev = r.evidence as { resourcesFetched: number; domain: string };
    expect(ev.resourcesFetched).toBe(1);
    expect(ev.domain).toBe("x.test");
  });

  it("readiness-scan: fail when scanner throws / returns nothing / uri missing", async () => {
    const throwing = createPolicyRegistry({
      scan: async () => {
        throw new Error("dns boom");
      },
    });
    expect(
      (
        await throwing["readiness-scan"]({
          deliverable: {},
          deliverableUri: "https://x.test",
        })
      ).pass,
    ).toBe(false);
    const empty = createPolicyRegistry({
      scan: async () => ({ domain: "x.test", scannedAt: "", snapshots: {} }),
    });
    expect(
      (
        await empty["readiness-scan"]({
          deliverable: {},
          deliverableUri: "https://x.test",
        })
      ).pass,
    ).toBe(false);
    expect((await registry["readiness-scan"]({ deliverable: {} })).pass).toBe(
      false,
    );
  });

  it("readiness-scan: bounded — scan timeout fails the verdict", async () => {
    const slow = createPolicyRegistry({
      scan: () => new Promise(() => { }), // never resolves
      scanTimeoutMs: 20,
    });
    const r = await slow["readiness-scan"]({
      deliverable: {},
      deliverableUri: "https://x.test",
    });
    expect(r.pass).toBe(false);
    expect(r.reason).toContain("timeout");
  });

  it("withTimeout rejects on expiry", async () => {
    await expect(
      withTimeout(new Promise(() => { }), 10, "x"),
    ).rejects.toThrow("x timeout after 10ms");
  });
});

describe("issueVerdict orchestration", () => {
  let store: VerdictStoreBackend;
  beforeEach(() => {
    store = createJsonVerdictStore(
      join(mkdtempSync(join(tmpdir(), "eaas-")), "v.json"),
    );
  });

  const req: IssueVerdictRequest = {
    policy: "deliverable-present",
    deliverable: { report: "ok" },
    nonce: 42,
    consumerWallet: "0x" + "aa".repeat(20),
  };

  it("issues a signed, verifiable artifact", async () => {
    const { artifact, duplicate } = await issueVerdict(req, {
      signer,
      store,
      now: () => new Date("2026-10-02T12:00:00Z"),
    });
    expect(duplicate).toBe(false);
    expect(artifact.kind).toBe("approve");
    expect(artifact.evaluator.toLowerCase()).toBe(signer.address.toLowerCase());
    expect(artifact.chainId).toBe(CHAIN_ID);
    expect(verifyVerdictSignature(artifact)).toBe(true);
  });

  it("same (deliverableHash, policy, nonce) → same verdictId, no re-write", async () => {
    const first = await issueVerdict(req, { signer, store });
    const second = await issueVerdict(req, { signer, store });
    expect(second.duplicate).toBe(true);
    expect(second.artifact.verdictId).toBe(first.artifact.verdictId);
    expect(second.artifact.signature).toBe(first.artifact.signature);
    expect(store.list().length).toBe(1);
  });

  it("different nonce → new verdictId", async () => {
    const a = await issueVerdict(req, { signer, store });
    const b = await issueVerdict({ ...req, nonce: 43 }, { signer, store });
    expect(b.duplicate).toBe(false);
    expect(a.artifact.verdictId).not.toBe(b.artifact.verdictId);
    expect(store.list().length).toBe(2);
  });
});

describe("VerdictStore json/sqlite parity", () => {
  const wallets = ["0x" + "aa".repeat(20), "0x" + "bb".repeat(20)];

  async function fill(store: VerdictStoreBackend): Promise<void> {
    for (let i = 0; i < 3; i++) {
      const unsigned = makeUnsigned({
        verdictId: ("0x" + String(i + 1).padStart(64, "0")) as Hex,
        issuedAt: `2026-10-02T12:00:0${i}.000Z`,
      });
      const v: StoredVerdict = {
        artifact: { ...unsigned, signature: ("0x" + "cc".repeat(65)) as Hex },
        consumerWallet: wallets[i % 2],
        evidence: { i },
      };
      store.put(v);
    }
  }

  function view(store: VerdictStoreBackend) {
    return {
      count: store.list().length,
      byConsumer: store.list(wallets[0]).length,
      byDeliverable: store.getByDeliverable(makeUnsigned().deliverableHash)
        .length,
      newestFirst: store.list().map((v) => v.artifact.issuedAt),
    };
  }

  it("json backend: put/get/getByDeliverable/list", async () => {
    const dir = mkdtempSync(join(tmpdir(), "eaas-json-"));
    const store = createJsonVerdictStore(join(dir, "v.json"));
    await fill(store);
    const v = view(store);
    expect(v.count).toBe(3);
    expect(v.byConsumer).toBe(2); // wallets[0] on i=0,2
    expect(v.byDeliverable).toBe(3);
    expect(v.newestFirst[0]).toBe("2026-10-02T12:00:02.000Z");
    // idempotent put: re-putting the same verdictId is a no-op
    const first = store.list()[0];
    store.put(first);
    expect(store.list().length).toBe(3);
    rmSync(dir, { recursive: true, force: true });
  });

  it("sqlite backend: parity with json", async () => {
    const dir = mkdtempSync(join(tmpdir(), "eaas-sqlite-"));
    const store = createSqliteVerdictStore(join(dir, "v.db"));
    if (!store) return; // node vitest: bun:sqlite unavailable — json covers semantics
    await fill(store);
    const v = view(store);
    expect(v.count).toBe(3);
    expect(v.byConsumer).toBe(2);
    expect(v.byDeliverable).toBe(3);
    expect(v.newestFirst[0]).toBe("2026-10-02T12:00:02.000Z");
    const first = store.list()[0];
    store.put(first);
    expect(store.list().length).toBe(3);
    rmSync(dir, { recursive: true, force: true });
  });
});
