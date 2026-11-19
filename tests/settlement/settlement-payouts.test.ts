/**
 * SLICE-227-2: markLegPaid — txHash format/binding, replay guard,
 * leg→intent→milestone→plan rollup, VerifyPayoutTx fail-closed seam,
 * post-effect audit surface. Memory bundle.
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { Database } from "@agentbadge/database";

import {
  approveMilestone,
  markLegPaid,
  submitForReview,
} from "../../src/server/lib/settlement/index.js";
import type {
  SettlementCtx,
  VerifyPayoutTx,
} from "../../src/server/lib/settlement/index.js";

import {
  approvedIntent,
  BUYER,
  codeOf,
  FEE,
  freshCtx,
  openPlan,
  OPS,
  PROVIDER,
  STRANGER,
  TX1,
  TX2,
} from "./helpers.js";

let db: Database;
let ctx: SettlementCtx;
beforeEach(() => {
  ({ db, ctx } = freshCtx());
});

describe("markLegPaid", () => {
  it("rejects a missing or malformed txHash", async () => {
    const { intentId } = await approvedIntent(ctx);
    for (const txHash of ["", "0x123", "deadbeef", `0x${"z".repeat(64)}`]) {
      const r = await markLegPaid(ctx, { intentId, txHash, operator: OPS });
      expect(codeOf(r)).toBe("BAD_INPUT");
    }
  });

  it("requires an operator label", async () => {
    const { intentId } = await approvedIntent(ctx);
    const r = await markLegPaid(ctx, {
      intentId,
      txHash: TX1,
      operator: "   ",
    });
    expect(codeOf(r)).toBe("OPERATOR_REQUIRED");
  });

  it("completes the leg, rolls up intent → milestone → plan", async () => {
    const { intentId } = await approvedIntent(ctx);
    const r = await markLegPaid(ctx, { intentId, txHash: TX1, operator: OPS });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.leg.status).toBe("COMPLETED");
    expect(r.value.leg.txHash).toBe(TX1);
    expect(r.value.intent.status).toBe("COMPLETED");
    expect(r.value.milestone.status).toBe("RELEASED");
    expect(r.value.auditRecorded).toBe(true);
    expect(r.value.verified).toBeNull();
  });

  it("binds txHash set-once — a second mark on the intent is INVALID_STATE", async () => {
    const { intentId } = await approvedIntent(ctx);
    await markLegPaid(ctx, { intentId, txHash: TX1, operator: OPS });
    const r = await markLegPaid(ctx, { intentId, txHash: TX2, operator: OPS });
    expect(codeOf(r)).toBe("INVALID_STATE");
  });

  it("rejects txHash replay across intents (TX_REUSED)", async () => {
    const { intentId: i1 } = await approvedIntent(ctx);
    const { intentId: i2 } = await approvedIntent(ctx);
    await markLegPaid(ctx, { intentId: i1, txHash: TX1, operator: OPS });
    const r = await markLegPaid(ctx, {
      intentId: i2,
      txHash: TX1,
      operator: OPS,
    });
    expect(codeOf(r)).toBe("TX_REUSED");
  });

  it("keeps the intent OPEN until every leg completes", async () => {
    const { milestones } = await openPlan(ctx, [
      {
        milestoneId: "m1",
        title: "split",
        amountUsd: "10.00",
        legs: [
          { payee: PROVIDER, amountUsdc: "8.00", role: "PROVIDER" },
          { payee: FEE, amountUsdc: "2.00", role: "PLATFORM_FEE" },
        ],
      },
    ]);
    const m = milestones[0]!;
    await submitForReview(ctx, { milestoneRowId: m.id }, PROVIDER);
    const ap = await approveMilestone(ctx, m.id, BUYER);
    if (!ap.ok) throw new Error("approve failed");
    const rows = await db.settlement.payoutLegs.listByIntent(ap.value.intentId);
    // Two OPEN legs — legId is mandatory.
    const ambiguous = await markLegPaid(ctx, {
      intentId: ap.value.intentId,
      txHash: TX1,
      operator: OPS,
    });
    expect(codeOf(ambiguous)).toBe("BAD_INPUT");
    const first = await markLegPaid(ctx, {
      intentId: ap.value.intentId,
      legId: rows[0]!.id,
      txHash: TX1,
      operator: OPS,
    });
    expect(first.ok && first.value.intent.status).toBe("OPEN");
    const second = await markLegPaid(ctx, {
      intentId: ap.value.intentId,
      legId: rows[1]!.id,
      txHash: TX2,
      operator: OPS,
    });
    expect(second.ok).toBe(true);
    if (second.ok) {
      expect(second.value.intent.status).toBe("COMPLETED");
      expect(second.value.milestone.status).toBe("RELEASED");
    }
  });
});

describe("VerifyPayoutTx seam", () => {
  it("fails closed when verification is required but unwired", async () => {
    const { intentId } = await approvedIntent(ctx);
    const r = await markLegPaid(
      ctx,
      { intentId, txHash: TX1, operator: OPS },
      { requireVerification: true },
    );
    expect(codeOf(r)).toBe("VERIFIER_UNAVAILABLE");
    const leg = (await db.settlement.payoutLegs.listByIntent(intentId))[0]!;
    expect(leg.status).toBe("OPEN");
    expect(leg.txHash).toBeNull();
  });

  it("treats an empty/malformed verifier response as TX_UNVERIFIED", async () => {
    const { intentId } = await approvedIntent(ctx);
    const empty = (async () => ({}) as never) as VerifyPayoutTx;
    const r = await markLegPaid(
      ctx,
      { intentId, txHash: TX1, operator: OPS },
      { verifyTx: empty },
    );
    expect(codeOf(r)).toBe("TX_UNVERIFIED");
  });

  it("fails when the verifier reports not-verified", async () => {
    const { intentId } = await approvedIntent(ctx);
    const no: VerifyPayoutTx = async () => ({
      verified: false,
      reason: "no matching transfer",
    });
    const r = await markLegPaid(
      ctx,
      { intentId, txHash: TX1, operator: OPS },
      { verifyTx: no },
    );
    expect(codeOf(r)).toBe("TX_UNVERIFIED");
  });

  it("rejects a verified tx whose reported payee contradicts the leg", async () => {
    const { intentId } = await approvedIntent(ctx);
    const liar: VerifyPayoutTx = async () => ({
      verified: true,
      payee: STRANGER,
    });
    const r = await markLegPaid(
      ctx,
      { intentId, txHash: TX1, operator: OPS },
      { verifyTx: liar },
    );
    expect(codeOf(r)).toBe("TX_UNVERIFIED");
  });

  it("completes with verified=true when the adapter passes", async () => {
    const { intentId } = await approvedIntent(ctx);
    // H5: verified:true must carry the mandatory reported facts —
    // an attestation without fields fails closed.
    const yes: VerifyPayoutTx = async (_tx, expected) => ({
      verified: true,
      asset: expected.currency,
      payee: expected.payee,
      amount: expected.amount,
      network: expected.network,
      confirmations: 3,
    });
    const r = await markLegPaid(
      ctx,
      { intentId, txHash: TX1, operator: OPS },
      { verifyTx: yes },
    );
    expect(r.ok && r.value.verified).toBe(true);
  });
});
