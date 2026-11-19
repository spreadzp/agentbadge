/**
 * SLICE-227-8: operator force-actions, dispute/freeze guards, approval
 * revert + intent reopen (R3/R4/R5 audit regressions). Split from
 * settlement-lifecycle.test.ts under the staged-file token cap.
 * Memory bundle — PG parity lives in packages/database.
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { Database } from "@agentbadge/database";

import {
  approveMilestone,
  createPlan,
  forceApproveMilestone,
  forceReopenMilestone,
  isLegalTransition,
  raiseDispute,
  reopenMilestone,
  revertApproval,
  submitForReview,
} from "../../src/server/lib/settlement/index.js";
import type { SettlementCtx } from "../../src/server/lib/settlement/index.js";

import {
  BUYER,
  freshCtx,
  openPlan,
  OPS,
  PROVIDER,
} from "./helpers.js";

let db: Database;
let ctx: SettlementCtx;
beforeEach(() => {
  ({ db, ctx } = freshCtx());
});

describe("R3: EVALUATOR_VERDICT + force-approve + freeze guards", () => {
  it("rejects EVALUATOR_VERDICT at plan create (v1 cannot approve it)", async () => {
    const r = await createPlan(
      ctx,
      {
        agreementRef: `agr-${crypto.randomUUID()}`,
        buyerWallet: BUYER,
        providerWallet: PROVIDER,
        totalUsd: "10.00",
        milestones: [
          {
            milestoneId: "m1",
            title: "eval work",
            amountUsd: "10.00",
            releasePolicy: "EVALUATOR_VERDICT",
          },
        ],
      },
      BUYER,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("BAD_INPUT");
  });

  it("forceApproveMilestone: READY → APPROVED + intent; idempotent on APPROVED", async () => {
    const { plan, milestones } = await openPlan(ctx);
    const m = milestones[0]!;
    await submitForReview(ctx, { milestoneRowId: m.id }, PROVIDER);
    const ap = await forceApproveMilestone(ctx, m.id, { operator: OPS, reason: "test recovery" });
    expect(ap.ok).toBe(true);
    if (!ap.ok) return;
    expect(ap.value.milestone.status).toBe("APPROVED");
    const intent = await db.settlement.payoutIntents.getByMilestone(m.id);
    expect(intent?.id).toBe(ap.value.intentId);
    // Idempotent — a second call returns the same intent.
    const again = await forceApproveMilestone(ctx, m.id, { operator: OPS, reason: "test recovery" });
    expect(again.ok).toBe(true);
    if (again.ok) expect(again.value.intentId).toBe(ap.value.intentId);
    expect(plan.status).toBe("ACTIVE");
  });

  it("forceApproveMilestone rejects PENDING milestones and OPEN disputes", async () => {
    const { milestones } = await openPlan(ctx);
    const m = milestones[0]!;
    const pending = await forceApproveMilestone(ctx, m.id, { operator: OPS, reason: "test recovery" });
    expect(pending.ok).toBe(false);
    if (!pending.ok) expect(pending.error.code).toBe("INVALID_STATE");

    await submitForReview(ctx, { milestoneRowId: m.id }, PROVIDER);
    await raiseDispute(ctx, {
      subjectType: "MILESTONE",
      subjectRef: m.id,
      raisedBy: BUYER,
      reason: "gate check",
    });
    const blocked = await forceApproveMilestone(ctx, m.id, { operator: OPS, reason: "test recovery" });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.error.code).toBe("INVALID_STATE");
  });

  it("rejects an AGREEMENT dispute on a terminal plan (empty freeze)", async () => {
    const { plan, milestones } = await openPlan(ctx);
    for (const m of milestones) {
      await db.settlement.milestones.applyStatus(m.id, "PENDING", "CANCELLED");
    }
    const r = await raiseDispute(ctx, {
      subjectType: "AGREEMENT",
      subjectRef: plan.agreementRef,
      raisedBy: BUYER,
      reason: "too late",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("INVALID_STATE");
  });

  it("rejects a second dispute when the plan is already DISPUTED", async () => {
    const { plan, milestones } = await openPlan(ctx);
    const d1 = await raiseDispute(ctx, {
      subjectType: "MILESTONE",
      subjectRef: milestones[0]!.id,
      raisedBy: BUYER,
      reason: "first",
    });
    expect(d1.ok).toBe(true);
    // Plan is now DISPUTED — the CAS is the serialization point:
    // an AGREEMENT-scope dispute cannot re-claim it.
    const d2 = await raiseDispute(ctx, {
      subjectType: "AGREEMENT",
      subjectRef: plan.agreementRef,
      raisedBy: PROVIDER,
      reason: "second",
    });
    expect(d2.ok).toBe(false);
    if (!d2.ok) expect(d2.error.code).toBe("INVALID_STATE");
  });
});

describe("R4: approval revert + milestone release + force-approve audit", () => {
  it("revertApproval: APPROVED → READY + intent cancelled; idempotent", async () => {
    const { milestones } = await openPlan(ctx);
    const m = milestones[0]!;
    await submitForReview(ctx, { milestoneRowId: m.id }, PROVIDER);
    await approveMilestone(ctx, m.id, BUYER);
    const intent = await db.settlement.payoutIntents.getByMilestone(m.id);
    expect(intent?.status).toBe("OPEN");

    const r = await revertApproval(ctx, m.id, BUYER);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.reverted).toBe(true);
    expect(
      (await db.settlement.milestones.getById(m.id))?.status,
    ).toBe("READY");
    expect(
      (await db.settlement.payoutIntents.getByMilestone(m.id))?.status,
    ).toBe("CANCELLED");
    const legs = await db.settlement.payoutLegs.listByIntent(intent!.id);
    expect(legs.every((l) => l.status === "CANCELLED")).toBe(true);

    // Idempotent — a READY milestone is a no-op.
    const again = await revertApproval(ctx, m.id, BUYER);
    expect(again.ok).toBe(true);
    if (again.ok) expect(again.value.reverted).toBe(false);
  });

  it("reopenMilestone: READY → PENDING + unbinds submissionRef", async () => {
    const { milestones } = await openPlan(ctx);
    const m = milestones[0]!;
    await submitForReview(
      ctx,
      { milestoneRowId: m.id, submissionRef: "sub_1" },
      PROVIDER,
    );
    const r = await reopenMilestone(ctx, m.id, BUYER);
    expect(r.ok).toBe(true);
    const after = await db.settlement.milestones.getById(m.id);
    expect(after?.status).toBe("PENDING");
    expect(after?.submissionRef).toBeNull();
    // Rebindable — a fresh submission can claim the milestone again.
    const resub = await submitForReview(
      ctx,
      { milestoneRowId: m.id, submissionRef: "sub_2" },
      PROVIDER,
    );
    expect(resub.ok).toBe(true);
  });

  it("forceApproveMilestone requires reason + writes an AdminAction", async () => {
    const { milestones } = await openPlan(ctx);
    const m = milestones[0]!;
    await submitForReview(ctx, { milestoneRowId: m.id }, PROVIDER);

    const noReason = await forceApproveMilestone(ctx, m.id, {
      operator: OPS,
      reason: "",
    });
    expect(noReason.ok).toBe(false);
    if (!noReason.ok) expect(noReason.error.code).toBe("BAD_INPUT");

    const blankOp = await forceApproveMilestone(ctx, m.id, {
      operator: "   ",
      reason: "recovery",
    });
    expect(blankOp.ok).toBe(false);
    if (!blankOp.ok) expect(blankOp.error.code).toBe("OPERATOR_REQUIRED");

    const ok = await forceApproveMilestone(ctx, m.id, {
      operator: OPS,
      reason: "stranded by swallowed post-commit approve",
      submissionRef: "sub_1",
    });
    expect(ok.ok).toBe(true);
    if (!ok.ok) return;
    expect(ok.value.auditRecorded).toBe(true);
    const actions = await db.finops.adminActions.list({
      subjectType: "milestone",
    });
    const mine = actions.find((a) => a.subjectId === m.id);
    expect(mine?.action).toBe("FORCE_APPROVE_MILESTONE");
  });

  it("forceApproveMilestone: APPROVED + CANCELLED intent is not idempotent-ok", async () => {
    const { milestones } = await openPlan(ctx);
    const m = milestones[0]!;
    await submitForReview(ctx, { milestoneRowId: m.id }, PROVIDER);
    await approveMilestone(ctx, m.id, BUYER);
    const intent = await db.settlement.payoutIntents.getByMilestone(m.id);
    await db.settlement.payoutIntents.applyStatus(
      intent!.id,
      "OPEN",
      "CANCELLED",
    );
    const r = await forceApproveMilestone(ctx, m.id, {
      operator: OPS,
      reason: "recovery",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("INVALID_STATE");
  });

  it("state machine: READY→PENDING and APPROVED→READY are legal; PENDING→APPROVED still is not", () => {
    expect(isLegalTransition("milestone", "READY", "PENDING")).toBe(true);
    expect(isLegalTransition("milestone", "APPROVED", "READY")).toBe(true);
    expect(isLegalTransition("milestone", "PENDING", "APPROVED")).toBe(false);
  });
});

describe("R5: revert hardening + intent reopen", () => {
  it("re-approve after revert re-opens the cancelled intent (R5-H1)", async () => {
    const { milestones } = await openPlan(ctx);
    const m = milestones[0]!;
    await submitForReview(ctx, { milestoneRowId: m.id }, PROVIDER);
    await approveMilestone(ctx, m.id, BUYER);
    const intent = await db.settlement.payoutIntents.getByMilestone(m.id);
    await revertApproval(ctx, m.id, BUYER);
    expect(
      (await db.settlement.payoutIntents.getByMilestone(m.id))?.status,
    ).toBe("CANCELLED");

    // Re-approve re-opens the same intent — no unique-slot brick.
    // R6-M1: the intent's OLD legs are never revived — fresh legs are
    // minted from the milestone template while the cancelled ones stay
    // as the audit trail (reviving them would double-allocate legs a
    // dispute SPLIT cancelled).
    const ap = await approveMilestone(ctx, m.id, BUYER);
    expect(ap.ok).toBe(true);
    if (!ap.ok) return;
    expect(ap.value.intentId).toBe(intent!.id);
    const after = await db.settlement.payoutIntents.getById(intent!.id);
    expect(after?.status).toBe("OPEN");
    const legs = await db.settlement.payoutLegs.listByIntent(intent!.id);
    const open = legs.filter((l) => l.status === "OPEN");
    expect(open.length).toBe(1);
    expect(open[0]!.amountUsdc).toBe(m.amountUsd);
    // The reopened leg is a NEW row — the cancelled one is untouched.
    expect(ap.value.legs).toEqual([open[0]!.id]);
    expect(legs.filter((l) => l.status === "CANCELLED").length).toBe(1);
  });

  it("re-approve never revives cancelled legs (R6-M1 double-allocation)", async () => {
    const { milestones } = await openPlan(ctx);
    const m = milestones[0]!;
    await submitForReview(ctx, { milestoneRowId: m.id }, PROVIDER);
    await approveMilestone(ctx, m.id, BUYER);
    const intent = await db.settlement.payoutIntents.getByMilestone(m.id);
    await revertApproval(ctx, m.id, BUYER);
    // Simulate SPLIT residue: extra CANCELLED legs on the same intent —
    // a dispute split cancels old legs but adds new ones on THIS row.
    await db.settlement.payoutLegs.create({
      id: `leg_residue_${Date.now()}`,
      intentId: intent!.id,
      payee: PROVIDER,
      amountUsdc: m.amountUsd,
      role: "PROVIDER",
      status: "CANCELLED",
      network: "arc",
      payload: { splitOf: "disp_x" },
    });
    const ap = await approveMilestone(ctx, m.id, BUYER);
    expect(ap.ok).toBe(true);
    if (!ap.ok) return;
    const legs = await db.settlement.payoutLegs.listByIntent(intent!.id);
    const open = legs.filter((l) => l.status === "OPEN");
    // Only the fresh template leg is payable — old + split-residue
    // legs stay CANCELLED, so OPEN legs can never sum past the
    // milestone amount.
    expect(open.length).toBe(1);
    expect(open[0]!.amountUsdc).toBe(m.amountUsd);
    expect(open[0]!.id).toBe(ap.value.legs[0]);
    expect(
      legs.filter((l) => l.status === "CANCELLED").length,
    ).toBe(2);
  });

  it("revertApproval release:true goes APPROVED→PENDING and unbinds", async () => {
    const { milestones } = await openPlan(ctx);
    const m = milestones[0]!;
    await submitForReview(
      ctx,
      { milestoneRowId: m.id, submissionRef: "sub_1" },
      PROVIDER,
    );
    await approveMilestone(ctx, m.id, BUYER);
    const r = await revertApproval(ctx, m.id, BUYER, { release: true });
    expect(r.ok).toBe(true);
    const after = await db.settlement.milestones.getById(m.id);
    expect(after?.status).toBe("PENDING");
    expect(after?.submissionRef).toBeNull();
    // Rebindable + re-payable: submit and approve re-open the intent.
    await submitForReview(
      ctx,
      { milestoneRowId: m.id, submissionRef: "sub_2" },
      PROVIDER,
    );
    const ap = await approveMilestone(ctx, m.id, BUYER);
    expect(ap.ok).toBe(true);
  });

  it("revertApproval ignores a foreign intentId (H-2)", async () => {
    const { milestones } = await openPlan(ctx);
    const m = milestones[0]!;
    await submitForReview(ctx, { milestoneRowId: m.id }, PROVIDER);
    await approveMilestone(ctx, m.id, BUYER);
    const r = await revertApproval(ctx, m.id, BUYER, {
      intentId: "pi_someone_else",
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.reverted).toBe(false);
    expect(
      (await db.settlement.milestones.getById(m.id))?.status,
    ).toBe("APPROVED");
    expect(
      (await db.settlement.payoutIntents.getByMilestone(m.id))?.status,
    ).toBe("OPEN");
  });

  it("revert is blocked when a leg already completed (M-5)", async () => {
    const { milestones } = await openPlan(ctx);
    const m = milestones[0]!;
    await submitForReview(ctx, { milestoneRowId: m.id }, PROVIDER);
    await approveMilestone(ctx, m.id, BUYER);
    const intent = await db.settlement.payoutIntents.getByMilestone(m.id);
    const legs = await db.settlement.payoutLegs.listByIntent(intent!.id);
    await db.settlement.payoutLegs.applyStatus(
      legs[0]!.id,
      "OPEN",
      "COMPLETED",
    );
    const r = await revertApproval(ctx, m.id, BUYER);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.reverted).toBe(false);
    // Nothing cancelled — the paid approval stands for operator review.
    expect(
      (await db.settlement.milestones.getById(m.id))?.status,
    ).toBe("APPROVED");
    expect(
      (await db.settlement.payoutIntents.getByMilestone(m.id))?.status,
    ).toBe("OPEN");
  });

  it("forceReopenMilestone: READY → PENDING, audited; idempotent", async () => {
    const { milestones } = await openPlan(ctx);
    const m = milestones[0]!;
    await submitForReview(
      ctx,
      { milestoneRowId: m.id, submissionRef: "sub_1" },
      PROVIDER,
    );
    const bad = await forceReopenMilestone(ctx, m.id, {
      operator: OPS,
      reason: "",
    });
    expect(bad.ok).toBe(false);
    const r = await forceReopenMilestone(ctx, m.id, {
      operator: OPS,
      reason: "release lost after reject verdict",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.reopened).toBe(true);
    expect(r.value.auditRecorded).toBe(true);
    const after = await db.settlement.milestones.getById(m.id);
    expect(after?.status).toBe("PENDING");
    expect(after?.submissionRef).toBeNull();
    const actions = await db.finops.adminActions.list({
      subjectType: "milestone",
    });
    expect(
      actions.find(
        (a) => a.subjectId === m.id && a.action === "REOPEN_MILESTONE",
      ),
    ).toBeTruthy();
    // Idempotent on non-READY.
    const again = await forceReopenMilestone(ctx, m.id, {
      operator: OPS,
      reason: "retry",
    });
    expect(again.ok).toBe(true);
    if (again.ok) expect(again.value.reopened).toBe(false);
  });
});
