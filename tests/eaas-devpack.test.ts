/**
 * SLICE-154-7 tests: developer pack.
 *
 *  - GET /api/eaas/stats — verdicts by policy/kind, anchors, subscribers
 *  - examples/eaas-client.ts — requestVerdict via injectable fetchFn,
 *    verifyArtifact offline EIP-712 (real signed artifact, tamper → false)
 *  - docs/EAAS — files exist + relative links resolve
 */
import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { mkdtempSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Wallet } from "ethers";
import { keccak256, toBytes, type Hex } from "viem";

import { createEaasFeedsRoutes } from "../src/server/routes/eaas-feeds-api";
import { createVerdictSigner, type VerdictArtifact } from "../src/server/lib/eaas/verdict";
import { createJsonVerdictStore } from "../src/server/lib/eaas/store";
import { createMemoryRequestStore } from "../src/server/lib/eaas/requests";
import { createEaasMetrics } from "../src/server/lib/eaas/metrics";
import { createMemorySubscriptionStore } from "../src/server/lib/eaas/subscription";
import { createMemoryAnchorStore } from "../src/server/lib/eaas/anchor";
import { issueVerdict } from "../src/server/lib/eaas";
import {
  requestVerdict,
  verifyArtifact,
} from "../examples/eaas-client";

const CHAIN_ID = 5042002;
const signer = createVerdictSigner(Wallet.createRandom().privateKey, CHAIN_ID);
const HERE = dirname(fileURLToPath(import.meta.url));

async function makeArtifact(
  store: ReturnType<typeof createJsonVerdictStore>,
  policy = "deliverable-present",
  deliverable: unknown = { data: { x: 1 } },
  expectedHash?: Hex,
): Promise<VerdictArtifact> {
  const r = await issueVerdict(
    { policy, deliverable, ...(expectedHash ? { expectedHash } : {}) },
    { signer, store },
  );
  return r.artifact;
}

describe("SLICE-154-7: dev pack", () => {
  it("GET /api/eaas/stats aggregates policy/kind/anchors/subs", async () => {
    const dir = mkdtempSync(join(tmpdir(), "eaas-stats-"));
    const store = createJsonVerdictStore(join(dir, "v.json"));
    // one approve + one reject (hash-match mismatch)
    await makeArtifact(store);
    await makeArtifact(
      store,
      "hash-match",
      { data: { x: 1 } },
      keccak256(toBytes("different")),
    );

    const subs = createMemorySubscriptionStore();
    const now = Math.floor(Date.now() / 1000);
    subs.put({
      wallet: "0x" + "a".repeat(40), tier: "basic",
      expiresAt: now + 1000, quotaUsed: 0, resetAt: now + 1000,
      updatedAt: new Date().toISOString(),
    });
    subs.put({
      wallet: "0x" + "b".repeat(40), tier: "pro",
      expiresAt: now - 1, quotaUsed: 9, resetAt: now - 1,
      updatedAt: new Date().toISOString(),
    });
    const anchors = createMemoryAnchorStore();
    const a1 = keccak256(toBytes("v1"));
    anchors.put({ verdictId: a1, memoId: a1, artifactHash: a1, status: "anchored", attempts: 1 });
    const a2 = keccak256(toBytes("v2"));
    anchors.put({ verdictId: a2, memoId: a2, artifactHash: a2, status: "pending", attempts: 0 });

    const app = new Hono();
    app.route(
      "/",
      createEaasFeedsRoutes({
        store,
        requests: createMemoryRequestStore(),
        metrics: createEaasMetrics(),
        rateRpm: 600,
        subscriptions: subs,
        anchors,
      }),
    );

    const j = (await (
      await app.request("/api/eaas/stats")
    ).json()) as {
      verdicts: { total: number; byPolicy: Record<string, number>; byKind: Record<string, number> };
      anchors: { anchored: number; pending: number };
      subscriptions: { total: number; active: number; byTier: Record<string, number> };
    };
    expect(j.verdicts.total).toBe(2);
    expect(j.verdicts.byPolicy["deliverable-present"]).toBe(1);
    expect(j.verdicts.byPolicy["hash-match"]).toBe(1);
    expect(j.verdicts.byKind.approve).toBe(1);
    expect(j.verdicts.byKind.reject).toBe(1);
    expect(j.anchors.anchored).toBe(1);
    expect(j.anchors.pending).toBe(1);
    expect(j.subscriptions.total).toBe(2);
    expect(j.subscriptions.active).toBe(1);
    expect(j.subscriptions.byTier.basic).toBe(1);
  });

  it("eaas-client: requestVerdict → verifyArtifact offline → tamper fails", async () => {
    const dir = mkdtempSync(join(tmpdir(), "eaas-client-"));
    const store = createJsonVerdictStore(join(dir, "v.json"));
    const artifact = await makeArtifact(store);

    const calls: { url: string; body: string }[] = [];
    const fetchFn = (async (input: unknown, init?: RequestInit) => {
      calls.push({ url: String(input), body: String(init?.body) });
      return new Response(JSON.stringify({ artifact, duplicate: false }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    const res = await requestVerdict({
      endpoint: "http://mock",
      policy: "deliverable-present",
      deliverable: { x: 1 },
      fetchFn,
    });
    expect(res.status).toBe(200);
    expect(calls[0]!.url).toBe("http://mock/api/eaas/verdicts");
    expect(JSON.parse(calls[0]!.body).deliverable).toEqual({ data: { x: 1 } });
    expect(await verifyArtifact(res.artifact!)).toBe(true);
    expect(await verifyArtifact({ ...res.artifact!, reason: "tampered" })).toBe(false);
  });

  it("docs/EAAS exists and relative links resolve", () => {
    const eaasDocs = resolve(HERE, "../../../docs/EAAS");
    for (const f of ["README.md", "QUICKSTART.md", "POLICIES.md"]) {
      expect(existsSync(join(eaasDocs, f)), f).toBe(true);
    }
    // markdown links only: ](path) — skips inline-code parens like (EaaS)
    const readme = readFileSync(join(eaasDocs, "README.md"), "utf8");
    for (const m of readme.matchAll(/\]\(([^)]+)\)/g)) {
      const link = m[1]!;
      if (link.startsWith("http") || link.startsWith("#")) continue;
      expect(
        existsSync(resolve(eaasDocs, link)),
        `broken link ${link}`,
      ).toBe(true);
    }
  });
});
