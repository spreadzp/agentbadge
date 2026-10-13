/**
 * SLICE-180-1: public Level-1 verify facade — GET /api/verify/:verdictId.
 *
 * "Don't trust us — check it yourself": one endpoint that returns the
 * stored verdict + machine reason codes + per-verdict memo anchor state +
 * hash-chain status (anchored|pending) + a head_ref pointer for offline
 * recomputation. Unknown id → honest 404 verdict_not_found; never a
 * fake-valid.
 */
import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Wallet } from "ethers";
import type { Hex } from "viem";

import { createVerdictSigner } from "../src/server/lib/eaas/verdict";
import { createJsonVerdictStore } from "../src/server/lib/eaas/store";
import { issueVerdict } from "../src/server/lib/eaas/index";
import {
  createMemoryAnchorStore,
  verdictMemoId,
} from "../src/server/lib/eaas/anchor";
import {
  createChainService,
  createMemoryChainStore,
} from "../src/server/lib/eaas/chain";
import { createVerifyRoutes } from "../src/server/routes/verify-api";
import { createBountyRoutes } from "../src/server/routes/bounty-api";

const CHAIN_ID = 5042002;
const signer = createVerdictSigner(Wallet.createRandom().privateKey, CHAIN_ID);
const REQ = { policy: "deliverable-present", deliverable: { x: 1 } };
const EXPLORER = (tx: string) => `https://arc.test/tx/${tx}`;
const ANCHOR_TX =
  "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef" as Hex;

interface SeedOpts {
  withAnchors?: boolean;
  anchorStatus?: "pending" | "anchored" | "failed";
  withChain?: boolean;
  headAnchor?: { epochSeq: number; txHash: Hex; blockNumber: string };
}

async function seeded(opts: SeedOpts = {}) {
  const dir = mkdtempSync(join(tmpdir(), "verify-api-"));
  const store = createJsonVerdictStore(join(dir, "v.json"));
  const chainStore = opts.withChain ? createMemoryChainStore() : undefined;
  const chain = chainStore
    ? createChainService({ store: chainStore })
    : undefined;
  const issued = await issueVerdict(
    { ...REQ, nonce: 7 },
    { signer, store, chain },
  );
  const verdictId = issued.artifact.verdictId;
  if (opts.headAnchor && chainStore) {
    // Simulate the 172-3 flusher having anchored the current head.
    chainStore.putHead({ ...chainStore.head()!, anchor: opts.headAnchor });
  }

  const anchors = opts.withAnchors ? createMemoryAnchorStore() : undefined;
  if (anchors) {
    anchors.put({
      verdictId,
      memoId: verdictMemoId(verdictId),
      artifactHash: "0x" as Hex,
      status: opts.anchorStatus ?? "pending",
      attempts: 0,
      ...(opts.anchorStatus === "anchored"
        ? { txHash: ANCHOR_TX, blockNumber: "123" }
        : {}),
    });
  }

  const app = new Hono().route(
    "/",
    createVerifyRoutes({
      store,
      rateRpm: 60,
      ...(anchors ? { anchors } : {}),
      ...(anchors || chain ? { explorerTx: EXPLORER } : {}),
      ...(chain ? { chain, chainId: CHAIN_ID } : {}),
    }),
  );
  return { app, store, chain, anchors, verdictId };
}

describe("GET /api/verify/:verdictId", () => {
  it("returns verdict + reason_codes + verified_at for a known verdict", async () => {
    const s = await seeded();
    const r = await s.app.request(`/api/verify/${s.verdictId}`);
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.verdictId).toBe(s.verdictId);
    expect(body.verdict.kind).toBe("approve");
    expect(body.verdict.policy).toBe("deliverable-present");
    expect(body.verdict.signature).toMatch(/^0x[0-9a-f]+$/);
    expect(body.reason_codes).toContain("policy:deliverable-present");
    expect(body.reason_codes).toContain("kind:approve");
    expect(body.verified_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("unknown id → 404 verdict_not_found (honest, not fake-valid)", async () => {
    const s = await seeded();
    const bogus = `0x${"ab".repeat(32)}`;
    const r = await s.app.request(`/api/verify/${bogus}`);
    expect(r.status).toBe(404);
    const body = await r.json();
    expect(body.error).toBe("verdict_not_found");
  });

  it("malformed id → 400", async () => {
    const s = await seeded();
    const r = await s.app.request("/api/verify/not-a-hash");
    expect(r.status).toBe(400);
  });

  it("pending anchor → anchor.status:'pending' explicitly", async () => {
    const s = await seeded({ withAnchors: true, anchorStatus: "pending" });
    const r = await s.app.request(`/api/verify/${s.verdictId}`);
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.anchor.status).toBe("pending");
    expect(body.anchor.txHash).toBeUndefined();
  });

  it("anchored anchor → txHash + memoId + explorerUrl", async () => {
    const s = await seeded({ withAnchors: true, anchorStatus: "anchored" });
    const r = await s.app.request(`/api/verify/${s.verdictId}`);
    const body = await r.json();
    expect(body.anchor.status).toBe("anchored");
    expect(body.anchor.txHash).toBe(ANCHOR_TX);
    expect(body.anchor.memoId).toBe(verdictMemoId(s.verdictId));
    expect(body.anchor.explorerUrl).toBe(EXPLORER(ANCHOR_TX));
  });

  it("chain included, head not yet anchored → chain.status:'pending'", async () => {
    const s = await seeded({ withChain: true });
    const r = await s.app.request(`/api/verify/${s.verdictId}`);
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.chain.status).toBe("pending");
    expect(body.chain.head_ref.headHash).toBe(s.chain!.head().headHash);
    expect(body.chain.head_ref.seq).toBe(0);
  });

  it("chain included + head anchored → status:'anchored' + anchored_at", async () => {
    const s = await seeded({
      withChain: true,
      headAnchor: { epochSeq: 1, txHash: ANCHOR_TX, blockNumber: "456" },
    });
    const r = await s.app.request(`/api/verify/${s.verdictId}`);
    const body = await r.json();
    expect(body.chain.status).toBe("anchored");
    expect(body.chain.head_ref.headHash).toBe(s.chain!.head().headHash);
    expect(body.chain.anchored_at).toBeDefined();
    expect(body.chain.head_ref.anchor.txHash).toBe(ANCHOR_TX);
  });

  it("chain off → chain.status 'disabled' honest", async () => {
    const s = await seeded({ withChain: false });
    const r = await s.app.request(`/api/verify/${s.verdictId}`);
    const body = await r.json();
    expect(body.chain.status).toBe("disabled");
    expect(body.chain.head_ref).toBeUndefined();
  });
});

describe("?kind= — proof-kind registry (180-4)", () => {
  it("default response carries proof_kinds summary", async () => {
    const s = await seeded();
    const r = await s.app.request(`/api/verify/${s.verdictId}`);
    const body = await r.json();
    expect(body.proof_kinds).toMatchObject({
      verdict: { specVersion: 1 },
      witness: { specVersion: 1 },
      "anchor-head": { specVersion: 1 },
    });
  });

  it("?kind=verdict narrows to the verdict layer", async () => {
    const s = await seeded();
    const r = await s.app.request(`/api/verify/${s.verdictId}?kind=verdict`);
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.kind).toBe("verdict");
    expect(body.proof.verdict).toBeTruthy();
    expect(body.proof.anchor).toBeTruthy();
    expect(body.proof.chain).toBeUndefined();
  });

  it("?kind=anchor-head narrows to the chain layer", async () => {
    const s = await seeded({ withChain: true });
    const r = await s.app.request(
      `/api/verify/${s.verdictId}?kind=anchor-head`,
    );
    const body = await r.json();
    expect(body.kind).toBe("anchor-head");
    expect(body.proof.chain.status).toBe("pending");
  });

  it("?kind=witness → declared but unimplemented", async () => {
    const s = await seeded();
    const r = await s.app.request(`/api/verify/${s.verdictId}?kind=witness`);
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.proof.implemented).toBe(false);
  });

  it("?kind=bogus → 400 unknown_proof_kind + known list", async () => {
    const s = await seeded();
    const r = await s.app.request(`/api/verify/${s.verdictId}?kind=nope`);
    expect(r.status).toBe(400);
    const body = await r.json();
    expect(body.error).toBe("unknown_proof_kind");
    expect(body.kind).toBe("nope");
    expect(body.known).toContain("verdict");
    expect(body.known).toContain("anchor-head");
    expect(body.known).toContain("witness");
  });
});

describe("route disambiguation vs bounty /api/verify/:id", () => {
  // Production order: registerApiRoutes mounts bountyApiRoutes on /api
  // BEFORE wireEaas mounts verify-api. The bounty param is constrained
  // to its id shape (≤64, no 0x) so 66-char verdictIds fall through.
  it("66-char verdictId reaches the verdict route, not bounty", async () => {
    const s = await seeded();
    const app = new Hono()
      .route("/api", createBountyRoutes({}))
      .route("/", createVerifyRoutes({ store: s.store, rateRpm: 60 }));
    const r = await app.request(`/api/verify/${s.verdictId}`);
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.verdictId).toBe(s.verdictId);
  });

  it("unknown 66-char id → verdict_not_found, not 'unknown bountyId'", async () => {
    const s = await seeded();
    const app = new Hono()
      .route("/api", createBountyRoutes({}))
      .route("/", createVerifyRoutes({ store: s.store, rateRpm: 60 }));
    const bogus = `0x${"cd".repeat(32)}`;
    const r = await app.request(`/api/verify/${bogus}`);
    expect(r.status).toBe(404);
    const body = await r.json();
    expect(body.error).toBe("verdict_not_found");
  });

  it("bounty-shaped id still reaches the bounty handler", async () => {
    const app = new Hono().route("/api", createBountyRoutes({}));
    const r = await app.request("/api/verify/bounty_abc123");
    expect(r.status).toBe(404);
    const body = await r.json();
    // bounty handler responds, not the verdict route
    expect(JSON.stringify(body)).toContain("bounty");
  });
});

describe("SLICE-180-4: ?kind= proof-kind registry", () => {
  it("?kind=verdict returns focused verdict-layer proof", async () => {
    const s = await seeded({ withAnchors: true, anchorStatus: "anchored" });
    const r = await s.app.request(`/api/verify/${s.verdictId}?kind=verdict`);
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.kind).toBe("verdict");
    expect(body.proof.anchor.txHash).toBe(ANCHOR_TX);
    expect(body.proof.verdict.verdictId).toBe(s.verdictId);
    expect(body.chain).toBeUndefined(); // narrowed — only the layer asked for
  });

  it("?kind=anchor-head returns the chain layer only", async () => {
    const s = await seeded({
      withChain: true,
      headAnchor: { epochSeq: 0, txHash: ANCHOR_TX, blockNumber: "55" },
    });
    const r = await s.app.request(
      `/api/verify/${s.verdictId}?kind=anchor-head`,
    );
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.kind).toBe("anchor-head");
    expect(body.proof.chain.status).toBe("anchored");
    expect(body.proof.verdict).toBeUndefined();
  });

  it("?kind=witness → declared but unimplemented (implemented:false)", async () => {
    const s = await seeded();
    const r = await s.app.request(`/api/verify/${s.verdictId}?kind=witness`);
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.kind).toBe("witness");
    expect(body.proof.implemented).toBe(false);
  });

  it("?kind=bogus → 400 unknown_proof_kind + known list", async () => {
    const s = await seeded();
    const r = await s.app.request(`/api/verify/${s.verdictId}?kind=bogus`);
    expect(r.status).toBe(400);
    const body = await r.json();
    expect(body.error).toBe("unknown_proof_kind");
    expect(body.kind).toBe("bogus");
    expect(body.known).toContain("verdict");
    expect(body.known).toContain("anchor-head");
  });

  it("full response carries proof_kinds registry summary", async () => {
    const s = await seeded();
    const r = await s.app.request(`/api/verify/${s.verdictId}`);
    const body = await r.json();
    expect(body.proof_kinds.verdict.specVersion).toBe(1);
    expect(body.proof_kinds["anchor-head"].specVersion).toBe(1);
  });
});
