/**
 * SLICE-227-4 (MYPROJ-2892): settlement-receipt@1 artifact + memo anchor.
 *
 * Determinism (byte-identical rebuild), EIP-712 verify/tamper, issuedAt
 * = last RELEASED leg, schema drift vs the static well-known document,
 * anchor gating/dedupe/drain — SendAnchorFn seam, never fabricated.
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { Database } from "@agentbadge/database";

import {
  approveMilestone,
  buildReceiptPublic,
  buildSettlementReceipt,
  createSettlementReceiptSigner,
  drainSettlementAnchors,
  getSettlementReceipt,
  markLegPaid,
  submitForReview,
  requestReceiptAnchor,
  SettlementReceiptSchemaV1,
  verifySettlementReceiptSignature,
} from "../../src/server/lib/settlement/index.js";
import type {
  SettlementCtx,
  SettlementReceipt,
} from "../../src/server/lib/settlement/index.js";
import type { SendAnchorFn } from "../../src/server/lib/eaas/anchor.js";

import {
  approvedIntent,
  BUYER,
  codeOf,
  freshCtx,
  openPlan,
  OPS,
  PROVIDER,
  STRANGER,
  TX1,
} from "./helpers.js";

const SIGNER_KEY =
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"; // anvil
const CHAIN_ID = 5042002;
const MEMO = "0x5294E9927c3306DcBaDb03fe70b92e01cCede505" as const;
const MEMO_TX = `0x${"f".repeat(64)}` as const;

let db: Database;
let ctx: SettlementCtx;
const signer = createSettlementReceiptSigner(SIGNER_KEY, CHAIN_ID);

beforeEach(() => {
  ({ db, ctx } = freshCtx());
});

/** Fully released plan: submit → approve → pay every milestone. */
async function releasedPlan() {
  const { plan, milestones } = await openPlan(ctx);
  let intentId = "";
  const txs = [TX1, `0x${"d".repeat(64)}`];
  for (const [i, m] of milestones.entries()) {
    await submitForReview(
      ctx,
      { milestoneRowId: m.id, submissionRef: `ipfs://w-${i}` },
      PROVIDER,
    );
    const ap = await approveMilestone(ctx, m.id, BUYER);
    expect(ap.ok).toBe(true);
    if (!ap.ok) throw new Error("approve failed");
    intentId = ap.value.intentId;
    const paid = await markLegPaid(ctx, {
      intentId,
      txHash: txs[i]!,
      operator: OPS,
    });
    expect(paid.ok).toBe(true);
  }
  const milestone = milestones[0]!;
  return { plan, milestone, intentId };
}

// ---------- receipt artifact ----------

describe("settlement-receipt@1", () => {
  it("is byte-identical on rebuild over the same state", async () => {
    const { plan } = await releasedPlan();
    const a = await buildSettlementReceipt(ctx, plan.agreementRef, {
      signer,
      chainId: CHAIN_ID,
    });
    const b = await buildSettlementReceipt(ctx, plan.agreementRef, {
      signer,
      chainId: CHAIN_ID,
    });
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    // body.chainId is BigInt — compare the deterministic fields that
    // external verifiers see: every public field + signature.
    const strip = ({ body: _b, ...rest }: SettlementReceipt) => rest;
    expect(JSON.stringify(strip(a.value))).toBe(
      JSON.stringify(strip(b.value)),
    );
    expect(a.value.signature).toBe(b.value.signature);
    expect(a.value.body.receiptHash).toBe(b.value.body.receiptHash);
  });

  it("verifies the EIP-712 signature and rejects tampering", async () => {
    const { plan } = await releasedPlan();
    const r = await buildSettlementReceipt(ctx, plan.agreementRef, {
      signer,
      chainId: CHAIN_ID,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(verifySettlementReceiptSignature(r.value)).toBe(true);
    const tampered: SettlementReceipt = {
      ...r.value,
      milestones: r.value.milestones.map((m) => ({
        ...m,
        amountUsd: "999.99",
      })),
    };
    expect(verifySettlementReceiptSignature(tampered)).toBe(false);
  });

  it("issuedAt equals the last COMPLETED leg timestamp", async () => {
    const { plan, intentId } = await releasedPlan();
    const leg = (await db.settlement.payoutLegs.listByIntent(intentId))[0]!;
    const r = await buildSettlementReceipt(ctx, plan.agreementRef, {
      signer,
      chainId: CHAIN_ID,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.issuedAt).toBe(new Date(leg.completedAtMs!).toISOString());
    expect(r.value.milestones[0]!.legs[0]!.txHash).toBe(TX1);
  });

  it("fails INVALID_STATE before any leg completes", async () => {
    const { plan } = await openPlan(ctx);
    const r = await buildSettlementReceipt(ctx, plan.agreementRef, {
      signer,
      chainId: CHAIN_ID,
    });
    expect(codeOf(r)).toBe("INVALID_STATE");
  });

  it("satisfies the well-known schema (no drift)", async () => {
    const { plan } = await releasedPlan();
    const r = await buildSettlementReceipt(ctx, plan.agreementRef, {
      signer,
      chainId: CHAIN_ID,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const { body: _body, ...publicPart } = r.value;
    const parsed = SettlementReceiptSchemaV1.safeParse(publicPart);
    expect(parsed.success).toBe(true);
  });

  it("receiptHash is stable across signer addresses only by design", async () => {
    const { plan } = await releasedPlan();
    const a = await buildReceiptPublic(ctx, plan.agreementRef, {
      signerAddress: signer.address,
      chainId: CHAIN_ID,
    });
    const b = await buildReceiptPublic(ctx, plan.agreementRef, {
      signerAddress: STRANGER,
      chainId: CHAIN_ID,
    });
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    // Signer is hash-bound — a different signer anchors a different hash.
    expect(a.value.receiptHash).not.toBe(b.value.receiptHash);
  });
});

// ---------- memo anchor ----------

describe("receipt anchor", () => {
  it("rejects while milestones are not all terminal", async () => {
    const { plan } = await approvedIntent(ctx);
    const r = await requestReceiptAnchor(ctx, plan.agreementRef, BUYER, {
      signerAddress: signer.address,
      chainId: CHAIN_ID,
    });
    expect(codeOf(r)).toBe("INVALID_STATE");
  });

  it("rejects a non-participant (admin flag bypasses)", async () => {
    const { plan } = await releasedPlan();
    const denied = await requestReceiptAnchor(ctx, plan.agreementRef, STRANGER, {
      signerAddress: signer.address,
      chainId: CHAIN_ID,
    });
    expect(codeOf(denied)).toBe("FORBIDDEN");
    const asAdmin = await requestReceiptAnchor(
      ctx,
      plan.agreementRef,
      "admin",
      { signerAddress: signer.address, chainId: CHAIN_ID },
      { admin: true },
    );
    expect(asAdmin.ok).toBe(true);
  });

  it("creates PENDING then ANCHORED with the real memo txHash", async () => {
    const { plan } = await releasedPlan();
    const req = await requestReceiptAnchor(ctx, plan.agreementRef, BUYER, {
      signerAddress: signer.address,
      chainId: CHAIN_ID,
    });
    expect(req.ok).toBe(true);
    if (!req.ok) return;
    expect(req.value.duplicate).toBe(false);
    expect(req.value.anchor.status).toBe("PENDING");
    expect(req.value.anchor.receiptHash).toMatch(/^0x[0-9a-f]{64}$/);
    // Idempotent — a second request returns the same row.
    const again = await requestReceiptAnchor(ctx, plan.agreementRef, PROVIDER, {
      signerAddress: signer.address,
      chainId: CHAIN_ID,
    });
    expect(again.ok && again.value.duplicate).toBe(true);

    const send: SendAnchorFn = async () => ({
      txHash: MEMO_TX,
      blockNumber: 1234n,
    });
    const drain = await drainSettlementAnchors(ctx, {
      send,
      memo: MEMO,
      selfAddress: signer.address as `0x${string}`,
    });
    expect(drain.anchored).toBe(1);
    const row = await ctx.db.settlement.anchors.getByReceiptRef(
      plan.agreementRef,
    );
    expect(row?.status).toBe("ANCHORED");
    expect(row?.txHash).toBe(MEMO_TX);
    // Receipt projection joins the anchor through.
    const projection = await getSettlementReceipt(ctx, plan.agreementRef);
    expect(projection?.anchor?.status).toBe("ANCHORED");
    expect(projection?.anchor?.txHash).toBe(MEMO_TX);
  });

  it("marks attempts and caps at FAILED — never fabricates a hash", async () => {
    const { plan } = await releasedPlan();
    await requestReceiptAnchor(ctx, plan.agreementRef, BUYER, {
      signerAddress: signer.address,
      chainId: CHAIN_ID,
    });
    const failSend: SendAnchorFn = async () => {
      throw new Error("rpc down");
    };
    const deps = {
      send: failSend,
      memo: MEMO,
      selfAddress: signer.address as `0x${string}`,
      retries: 2,
    };
    await drainSettlementAnchors(ctx, deps);
    let row = await ctx.db.settlement.anchors.getByReceiptRef(plan.agreementRef);
    expect(row?.status).toBe("PENDING");
    expect(row?.attempts).toBe(1);
    expect(row?.txHash ?? null).toBeNull();
    await drainSettlementAnchors(ctx, deps);
    row = await ctx.db.settlement.anchors.getByReceiptRef(plan.agreementRef);
    expect(row?.status).toBe("FAILED");
    expect(row?.txHash ?? null).toBeNull();
  });

  it("ANCHORED anchors are skipped by later drains", async () => {
    const { plan } = await releasedPlan();
    await requestReceiptAnchor(ctx, plan.agreementRef, BUYER, {
      signerAddress: signer.address,
      chainId: CHAIN_ID,
    });
    let calls = 0;
    const send: SendAnchorFn = async () => {
      calls += 1;
      return { txHash: MEMO_TX, blockNumber: 1n };
    };
    const deps = {
      send,
      memo: MEMO,
      selfAddress: signer.address as `0x${string}`,
    };
    await drainSettlementAnchors(ctx, deps);
    const again = await drainSettlementAnchors(ctx, deps);
    expect(again.anchored).toBe(0);
    expect(calls).toBe(1);
  });
});
