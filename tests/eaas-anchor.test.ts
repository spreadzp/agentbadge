/**
 * SLICE-154-4 tests: onchain memo anchoring + public verify endpoint.
 *
 * Unit: artifactHash/memoId derivation, enqueue→send payload, retry
 * backoff → anchored / failed, resumePending after restart.
 * Route: GET /api/eaas/verdicts/:id/verify (+ /api/eaas/verify/:id alias)
 * — signatureValid, anchor.found/contextMatches, explorerUrl,
 * disabled-anchor shape, rate limit.
 */
import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import type { Context, Next } from "hono";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Wallet } from "ethers";
import { decodeFunctionData } from "viem";
import type { Hex } from "viem";
import { MEMO_ABI, MEMO_CONTRACT, memoIdFor } from "@agentbadge/circle-payments";

import { createEaasRoutes } from "../src/server/routes/eaas-api";
import {
  createVerdictSigner,
  type VerdictArtifact,
} from "../src/server/lib/eaas/verdict";
import { createJsonVerdictStore } from "../src/server/lib/eaas/store";
import type { StoredVerdict } from "../src/server/lib/eaas/store";
import { issueVerdict } from "../src/server/lib/eaas/index";
import {
  artifactHashOf,
  createAnchorer,
  createJsonAnchorStore,
  createMemoryAnchorStore,
  verdictMemoId,
  type SendAnchorFn,
} from "../src/server/lib/eaas/anchor";
import type { PaymentMiddleware } from "../src/server/routes/identity";

const CHAIN_ID = 5042002;
const SIGNER_KEY = Wallet.createRandom().privateKey;
const signer = createVerdictSigner(SIGNER_KEY, CHAIN_ID);
const SELF = "0x2222222222222222222222222222222222222222" as const;
const CONSUMER = "0x1111111111111111111111111111111111111111";
const TX = "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef" as Hex;

const freePay = (): PaymentMiddleware =>
  (async (_c: Context, next: Next) => next()) as PaymentMiddleware;

async function issue() {
  const dir = mkdtempSync(join(tmpdir(), "eaas-anchor-"));
  const verdicts = createJsonVerdictStore(join(dir, "v.json"));
  const stored: StoredVerdict = {
    artifact: (await issueVerdict(
      { policy: "deliverable-present", deliverable: { data: { x: 1 } } },
      { signer, store: verdicts },
    )).artifact,
    consumerWallet: CONSUMER,
  };
  return { verdicts, stored };
}

/** Deterministic scheduler — collects timers, flush() runs them in order. */
function sched() {
  const q: { fn: () => void; ms: number }[] = [];
  return {
    q,
    schedule: (fn: () => void, ms: number) => void q.push({ fn, ms }),
    async flush() {
      while (q.length) {
        const t = q.shift()!;
        t.fn();
        await Promise.resolve();
        await Promise.resolve();
      }
    },
  };
}

describe("anchor enqueue → memo call", () => {
  it("sends memo(target, 0x, memoIdFor(eaas,id), artifactHash) → anchored", async () => {
    const { verdicts, stored } = await issue();
    const sent: { to: `0x${string}`; data: Hex }[] = [];
    const s = sched();
    const anchorStore = createMemoryAnchorStore();
    const anchorer = createAnchorer({
      store: anchorStore,
      verdicts,
      memo: MEMO_CONTRACT,
      selfAddress: SELF,
      send: async (tx) => {
        sent.push(tx);
        return { txHash: TX, blockNumber: 100n };
      },
      retries: 3,
      backoffMs: 1,
      schedule: s.schedule,
    });
    anchorer.enqueue(stored);
    await s.flush();

    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe(MEMO_CONTRACT);
    const decoded = decodeFunctionData({ abi: MEMO_ABI, data: sent[0]!.data });
    expect(decoded.functionName).toBe("memo");
    const [target, data, memoId, memoData] = decoded.args as [
      string,
      Hex,
      Hex,
      Hex,
    ];
    expect(target).toBe(CONSUMER); // consumer wallet when known
    expect(data).toBe("0x");
    expect(memoId).toBe(memoIdFor("eaas", stored.artifact.verdictId));
    expect(memoData).toBe(artifactHashOf(stored.artifact));

    const rec = anchorStore.get(stored.artifact.verdictId)!;
    expect(rec.status).toBe("anchored");
    expect(rec.txHash).toBe(TX);
    expect(rec.blockNumber).toBe("100");
  });

  it("self-anchors to sender EOA when consumerWallet absent", async () => {
    const dir = mkdtempSync(join(tmpdir(), "eaas-anchor-"));
    const verdicts = createJsonVerdictStore(join(dir, "v.json"));
    const artifact = (
      await issueVerdict(
        { policy: "deliverable-present", deliverable: { data: { y: 2 } } },
        { signer, store: verdicts },
      )
    ).artifact;
    const sent: { to: `0x${string}`; data: Hex }[] = [];
    const s = sched();
    const anchorer = createAnchorer({
      store: createMemoryAnchorStore(),
      verdicts,
      memo: MEMO_CONTRACT,
      selfAddress: SELF,
      send: async (tx) => {
        sent.push(tx);
        return { txHash: TX, blockNumber: 1n };
      },
      retries: 3,
      backoffMs: 1,
      schedule: s.schedule,
    });
    anchorer.enqueue({ artifact });
    await s.flush();
    const decoded = decodeFunctionData({ abi: MEMO_ABI, data: sent[0]!.data });
    expect((decoded.args as [string, Hex, Hex, Hex])[0]).toBe(SELF);
  });
});

describe("anchor retry queue", () => {
  async function run(fails: number, retries = 3) {
    const { verdicts, stored } = await issue();
    const anchorStore = createMemoryAnchorStore();
    const s = sched();
    let calls = 0;
    const send: SendAnchorFn = async () => {
      calls++;
      if (calls <= fails) throw new Error("rpc down");
      return { txHash: TX, blockNumber: 7n };
    };
    const anchorer = createAnchorer({
      store: anchorStore,
      verdicts,
      memo: MEMO_CONTRACT,
      selfAddress: SELF,
      send,
      retries,
      backoffMs: 1,
      schedule: s.schedule,
    });
    anchorer.enqueue(stored);
    await s.flush();
    return { anchorStore, calls, verdictId: stored.artifact.verdictId };
  }

  it("pending → anchored after transient failures", async () => {
    const { anchorStore, calls, verdictId } = await run(2, 3);
    expect(calls).toBe(3);
    const rec = anchorStore.get(verdictId)!;
    expect(rec.status).toBe("anchored");
    expect(rec.txHash).toBe(TX);
    expect(rec.blockNumber).toBe("7");
  });

  it("exhausted retries → failed", async () => {
    const { anchorStore, calls, verdictId } = await run(10, 3);
    expect(calls).toBe(3);
    const rec = anchorStore.get(verdictId)!;
    expect(rec.status).toBe("failed");
    expect(rec.attempts).toBe(3);
    expect(rec.lastError).toBe("rpc down");
  });

  it("resumePending re-attempts unfinished rows", async () => {
    const { verdicts, stored } = await issue();
    const anchorStore = createJsonAnchorStore(
      join(mkdtempSync(join(tmpdir(), "eaas-anch-")), "a.json"),
    );
    anchorStore.put({
      verdictId: stored.artifact.verdictId,
      memoId: verdictMemoId(stored.artifact.verdictId),
      artifactHash: artifactHashOf(stored.artifact),
      status: "pending",
      attempts: 1,
    });
    const s = sched();
    let calls = 0;
    createAnchorer({
      store: anchorStore,
      verdicts,
      memo: MEMO_CONTRACT,
      selfAddress: SELF,
      send: async () => {
        calls++;
        return { txHash: TX, blockNumber: 9n };
      },
      retries: 3,
      backoffMs: 1,
      schedule: s.schedule,
    }).resumePending();
    await s.flush();
    expect(calls).toBe(1);
    expect(anchorStore.get(stored.artifact.verdictId)!.status).toBe("anchored");
  });
});

describe("GET verify endpoint", () => {
  function makeVerifyApp(opts: {
    anchor?: Parameters<typeof createEaasRoutes>[0]["anchor"];
    rateRpm?: number;
  }) {
    const dir = mkdtempSync(join(tmpdir(), "eaas-verify-"));
    const store = createJsonVerdictStore(join(dir, "v.json"));
    const app = new Hono();
    app.route(
      "/",
      createEaasRoutes({
        paymentForPrice: () => freePay(),
        verdictUsd: "$0.01",
        scanUsd: "$0.05",
        maxBytes: 1024,
        rateRpm: opts.rateRpm ?? 60,
        signer,
        store,
        ...(opts.anchor ? { anchor: opts.anchor } : {}),
      }),
    );
    return { app, store };
  }

  it("signatureValid + anchor found + contextMatches + explorerUrl", async () => {
    const anchorStore = createMemoryAnchorStore();
    const { app, store } = makeVerifyApp({
      anchor: {
        anchorer: { enqueue: () => { } },
        store: anchorStore,
        find: async (memoId) => ({
          txHash: TX,
          blockNumber: 42n,
          memoData:
            anchorStore.list().find((r) => r.memoId === memoId)!.artifactHash,
          blockTime: 1700000000,
        }),
        explorerTx: (h) => `https://explorer.arc.io/tx/${h}`,
      },
    });
    const artifact = (
      await issueVerdict(
        { policy: "deliverable-present", deliverable: { data: { z: 3 } } },
        { signer, store },
      )
    ).artifact;
    anchorStore.put({
      verdictId: artifact.verdictId,
      memoId: verdictMemoId(artifact.verdictId),
      artifactHash: artifactHashOf(artifact),
      status: "anchored",
      attempts: 1,
      txHash: TX,
      blockNumber: "42",
    });

    const res = await app.request(
      `/api/eaas/verdicts/${artifact.verdictId}/verify`,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.signatureValid).toBe(true);
    expect(body.signer).toBe(signer.address);
    const anchor = body.anchor as Record<string, unknown>;
    expect(anchor.found).toBe(true);
    expect(anchor.contextMatches).toBe(true);
    expect(anchor.txHash).toBe(TX);
    expect(anchor.blockTime).toBe(1700000000);
    expect(body.explorerUrl).toBe(`https://explorer.arc.io/tx/${TX}`);
  });

  it("alias /api/eaas/verify/:id returns same shape", async () => {
    const { app, store } = makeVerifyApp({ anchor: undefined });
    const artifact = (
      await issueVerdict(
        { policy: "deliverable-present", deliverable: { data: { a: 4 } } },
        { signer, store },
      )
    ).artifact;
    const res = await app.request(`/api/eaas/verify/${artifact.verdictId}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.signatureValid).toBe(true);
    expect((body.anchor as Record<string, unknown>).status).toBe("none");
  });

  it("tampered artifact → signatureValid false", async () => {
    const { app, store } = makeVerifyApp({});
    const artifact = (
      await issueVerdict(
        { policy: "deliverable-present", deliverable: { data: { b: 5 } } },
        { signer, store },
      )
    ).artifact;
    const tampered: VerdictArtifact = { ...artifact, reason: "forged" };
    // idempotent put on same verdictId won't overwrite — use fresh store
    void app; // satisfy lint; app2 exercises tampered store
    const dir = mkdtempSync(join(tmpdir(), "eaas-tamper-"));
    const store2 = createJsonVerdictStore(join(dir, "v.json"));
    store2.put({ artifact: tampered });
    const app2 = new Hono();
    app2.route(
      "/",
      createEaasRoutes({
        paymentForPrice: () => freePay(),
        verdictUsd: "$0.01",
        scanUsd: "$0.05",
        maxBytes: 1024,
        rateRpm: 60,
        signer,
        store: store2,
      }),
    );
    const res = await app2.request(
      `/api/eaas/verdicts/${tampered.verdictId}/verify`,
    );
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.signatureValid).toBe(false);
  });

  it("no anchor record → anchor.found false, status none", async () => {
    const { app, store } = makeVerifyApp({
      anchor: {
        anchorer: { enqueue: () => { } },
        store: createMemoryAnchorStore(),
        find: async () => null,
      },
    });
    const artifact = (
      await issueVerdict(
        { policy: "deliverable-present", deliverable: { data: { c: 6 } } },
        { signer, store },
      )
    ).artifact;
    const res = await app.request(
      `/api/eaas/verdicts/${artifact.verdictId}/verify`,
    );
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.signatureValid).toBe(true);
    const anchor = body.anchor as Record<string, unknown>;
    expect(anchor.found).toBe(false);
    expect(anchor.status).toBe("none");
    expect(body.explorerUrl).toBeUndefined();
  });

  it("anchoring disabled (no anchor dep) → anchor.status none", async () => {
    const { app, store } = makeVerifyApp({});
    const artifact = (
      await issueVerdict(
        { policy: "deliverable-present", deliverable: { data: { d: 7 } } },
        { signer, store },
      )
    ).artifact;
    const res = await app.request(
      `/api/eaas/verdicts/${artifact.verdictId}/verify`,
    );
    const body = (await res.json()) as Record<string, unknown>;
    expect((body.anchor as Record<string, unknown>).status).toBe("none");
    expect((body.anchor as Record<string, unknown>).found).toBe(false);
  });

  it("verify is rate-limited", async () => {
    const { app, store } = makeVerifyApp({ rateRpm: 1 });
    const artifact = (
      await issueVerdict(
        { policy: "deliverable-present", deliverable: { data: { e: 8 } } },
        { signer, store },
      )
    ).artifact;
    const r1 = await app.request(
      `/api/eaas/verdicts/${artifact.verdictId}/verify`,
    );
    expect(r1.status).toBe(200);
    const r2 = await app.request(
      `/api/eaas/verdicts/${artifact.verdictId}/verify`,
    );
    expect(r2.status).toBe(429);
  });
});
