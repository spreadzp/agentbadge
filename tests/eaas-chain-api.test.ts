/**
 * SLICE-172-4: REST surface /api/eaas/chain* + verify extension.
 * Feeds routes carry the 3 GETs (free, rate-limited); verify returns the
 * chain membership digest. AC1: a third party recomputes headHash offline
 * from the proof path — covered by folding computeEntryHash over it.
 */
import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Wallet } from "ethers";
import type { Hex } from "viem";
import { computeEntryHash } from "@agentbadge/circle-payments";
import { createVerdictSigner } from "../src/server/lib/eaas/verdict";
import { createJsonVerdictStore } from "../src/server/lib/eaas/store";
import { createMemoryRequestStore } from "../src/server/lib/eaas/requests";
import { createEaasMetrics } from "../src/server/lib/eaas/metrics";
import {
  createChainService,
  createMemoryChainStore,
  VERDICT_CHAIN_DOMAIN,
} from "../src/server/lib/eaas/chain";
import { createEaasFeedsRoutes } from "../src/server/routes/eaas-feeds-api";
import { createEaasRoutes } from "../src/server/routes/eaas-api";
import { issueVerdict } from "../src/server/lib/eaas/index";

const signer = createVerdictSigner(Wallet.createRandom().privateKey, 5042002);
const REQ = { policy: "deliverable-present", deliverable: { x: 1 } };
const EXPLORER = (tx: string) => `https://arc.test/tx/${tx}`;

async function seeded(withChain: boolean) {
  const dir = mkdtempSync(join(tmpdir(), "eaas-chain-api-"));
  const store = createJsonVerdictStore(join(dir, "v.json"));
  const chain = withChain
    ? createChainService({ store: createMemoryChainStore() })
    : undefined;
  const v1 = await issueVerdict(
    { ...REQ, nonce: 1 },
    { signer, store, chain },
  );
  const v2 = await issueVerdict(
    { ...REQ, nonce: 2 },
    { signer, store, chain },
  );
  const feeds = new Hono().route(
    "/",
    createEaasFeedsRoutes({
      store,
      requests: createMemoryRequestStore(),
      metrics: createEaasMetrics(),
      rateRpm: 60,
      ...(chain
        ? { chain, chainId: 5042002, explorerTx: EXPLORER }
        : {}),
    }),
  );
  const api = new Hono().route(
    "/",
    createEaasRoutes({
      paymentForPrice: () => async (c, next) => next(),
      verdictUsd: "$0.01",
      scanUsd: "$0.05",
      maxBytes: 1024,
      rateRpm: 60,
      signer,
      store,
      ...(chain ? { chain } : {}),
    }),
  );
  return { feeds, api, chain, store, ids: [v1.artifact.verdictId, v2.artifact.verdictId] };
}

describe("/api/eaas/chain", () => {
  it("returns head + anchor meta", async () => {
    const s = await seeded(true);
    const r = await s.feeds.request("/api/eaas/chain");
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.domain).toBe(VERDICT_CHAIN_DOMAIN);
    expect(body.count).toBe(2);
    expect(body.headHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(body.chainId).toBe(5042002);
  });

  it("pages entries with capped limit", async () => {
    const s = await seeded(true);
    const r = await s.feeds.request("/api/eaas/chain/entries?from=0&limit=100");
    const body = await r.json();
    expect(body.entries).toHaveLength(2);
    expect(body.entries[0].seq).toBe(0);
    expect(body.entries[0].verdictId).toBe(s.ids[0]);
    const r2 = await s.feeds.request("/api/eaas/chain/entries?from=1&to=2");
    const b2 = await r2.json();
    expect(b2.entries).toHaveLength(1);
    expect(b2.entries[0].seq).toBe(1);
  });

  it("proof → third party recomputes headHash offline (AC1)", async () => {
    const s = await seeded(true);
    const r = await s.feeds.request(`/api/eaas/chain/proof/${s.ids[0]}`);
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.seq).toBe(0);
    // AC1: fold the suffix — prevHash(seed) ⊕ artifactHash per entry → headHash
    let h = body.path[0].prevHash as Hex;
    for (const e of body.path) {
      h = computeEntryHash(h, e.artifactHash as Hex);
    }
    expect(h).toBe(body.head.headHash);
    // proof covers the entry through the head (suffix)
    expect(body.path).toHaveLength(2);
    expect(body.path[0].verdictId).toBe(s.ids[0]);
    expect(body.path[1].verdictId).toBe(s.ids[1]);
  });

  it("proof 404 for a verdict not in the chain", async () => {
    const s = await seeded(true);
    const bogus = `0x${"ab".repeat(32)}`;
    const r = await s.feeds.request(`/api/eaas/chain/proof/${bogus}`);
    expect(r.status).toBe(404);
  });
});

describe("verify chain extension", () => {
  it("verify returns chain:{included,seq,headHash} when enabled", async () => {
    const s = await seeded(true);
    const r = await s.api.request(
      `/api/eaas/verdicts/${s.ids[0]}/verify`,
    );
    const body = await r.json();
    expect(body.valid).toBe(true);
    expect(body.chain.included).toBe(true);
    expect(body.chain.seq).toBe(0);
    expect(body.chain.headHash).toBe(s.chain!.head().headHash);
  });

  it("chain off → /chain* 404 and verify lacks the chain field", async () => {
    const s = await seeded(false);
    expect((await s.feeds.request("/api/eaas/chain")).status).toBe(404);
    expect(
      (await s.feeds.request("/api/eaas/chain/entries")).status,
    ).toBe(404);
    const r = await s.api.request(
      `/api/eaas/verdicts/${s.ids[0]}/verify`,
    );
    const body = await r.json();
    expect(body.valid).toBe(true);
    expect("chain" in body).toBe(false); // back-compat: field absent, not null
  });
});
