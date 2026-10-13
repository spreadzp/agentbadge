/**
 * SLICE-180-2 (EPIC-180): /verify SSR page — human-facing verdict lookup.
 *
 * Form input accepts verdictId / txHash / memoId; the page renders the
 * verdict + reason codes + anchor state + chain status with an honest
 * pending banner. No JS dependency — plain form GET/POST both work.
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
import { createVerifyPageRoutes } from "../src/server/routes/verify-page";

const CHAIN_ID = 5042002;
const signer = createVerdictSigner(Wallet.createRandom().privateKey, CHAIN_ID);
const REQ = { policy: "deliverable-present", deliverable: { x: 1 } };
const EXPLORER = (tx: string) => `https://arc.test/tx/${tx}`;
const ANCHOR_TX =
  "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef" as Hex;

async function seeded(opts: {
  anchored?: boolean;
  withChain?: boolean;
} = {}) {
  const dir = mkdtempSync(join(tmpdir(), "verify-page-"));
  const store = createJsonVerdictStore(join(dir, "v.json"));
  const chainStore = opts.withChain ? createMemoryChainStore() : undefined;
  const chain = chainStore
    ? createChainService({ store: chainStore })
    : undefined;
  const issued = await issueVerdict(
    { ...REQ, nonce: 11 },
    { signer, store, chain },
  );
  const verdictId = issued.artifact.verdictId;

  const anchors = createMemoryAnchorStore();
  anchors.put({
    verdictId,
    memoId: verdictMemoId(verdictId),
    artifactHash: "0x" as Hex,
    status: opts.anchored ? "anchored" : "pending",
    attempts: 0,
    ...(opts.anchored ? { txHash: ANCHOR_TX, blockNumber: "777" } : {}),
  });

  const app = new Hono().route(
    "/",
    createVerifyPageRoutes({
      store,
      rateRpm: 60,
      anchors,
      explorerTx: EXPLORER,
      ...(chain ? { chain } : {}),
    }),
  );
  return { app, verdictId };
}

describe("GET /verify", () => {
  it("renders the lookup form (no JS dependency)", async () => {
    const s = await seeded();
    const r = await s.app.request("/verify");
    expect(r.status).toBe(200);
    const html = await r.text();
    expect(html).toContain("<form");
    expect(html).toContain('name="q"');
    expect(html).toContain("verdict ID");
  });

  it("GET /verify/:id deep link renders the verdict", async () => {
    const s = await seeded();
    const r = await s.app.request(`/verify/${s.verdictId}`);
    expect(r.status).toBe(200);
    const html = await r.text();
    expect(html).toContain("approve");
    expect(html).toContain("deliverable-present");
    expect(html).toContain(s.verdictId);
  });

  it("GET /verify?q=<verdictId> renders the verdict", async () => {
    const s = await seeded();
    const r = await s.app.request(`/verify?q=${s.verdictId}`);
    expect(r.status).toBe(200);
    expect(await r.text()).toContain("deliverable-present");
  });

  it("pending anchor → explicit pending banner", async () => {
    const s = await seeded();
    const r = await s.app.request(`/verify/${s.verdictId}`);
    const html = await r.text();
    expect(html.toLowerCase()).toContain("pending");
    // honest: banner says pending, not "valid"/"anchored"
    expect(html).toContain("Anchor pending");
  });

  it("anchored anchor → txHash + explorer link", async () => {
    const s = await seeded({ anchored: true });
    const r = await s.app.request(`/verify/${s.verdictId}`);
    const html = await r.text();
    expect(html).toContain(ANCHOR_TX);
    expect(html).toContain(EXPLORER(ANCHOR_TX));
  });

  it("txHash input resolves to the verdict (reverse lookup)", async () => {
    const s = await seeded({ anchored: true });
    const r = await s.app.request(`/verify?q=${ANCHOR_TX}`);
    expect(r.status).toBe(200);
    const html = await r.text();
    expect(html).toContain(s.verdictId);
  });

  it("memoId input resolves to the verdict (reverse lookup)", async () => {
    const s = await seeded();
    const r = await s.app.request(`/verify?q=${verdictMemoId(s.verdictId)}`);
    expect(r.status).toBe(200);
    expect(await r.text()).toContain(s.verdictId);
  });

  it("malformed input → friendly message, not an error page", async () => {
    const s = await seeded();
    const r = await s.app.request("/verify?q=hello");
    expect(r.status).toBe(200);
    const html = await r.text();
    expect(html.toLowerCase()).toContain("doesn't look like");
  });

  it("unknown id → honest 404 view", async () => {
    const s = await seeded();
    const bogus = `0x${"ef".repeat(32)}`;
    const r = await s.app.request(`/verify/${bogus}`);
    expect(r.status).toBe(404);
    const html = await r.text();
    expect(html.toLowerCase()).toContain("not found");
  });

  it("POST /verify (form post) renders the result — non-JS fallback", async () => {
    const s = await seeded();
    const r = await s.app.request("/verify", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: `q=${s.verdictId}`,
    });
    expect(r.status).toBe(200);
    expect(await r.text()).toContain("deliverable-present");
  });

  it("chain status shown when chain enabled", async () => {
    const s = await seeded({ withChain: true });
    const r = await s.app.request(`/verify/${s.verdictId}`);
    const html = await r.text();
    expect(html).toContain("pending"); // chain not yet head-anchored
    expect(html).toContain("headHash");
  });
});
