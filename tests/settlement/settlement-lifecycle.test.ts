/**
 * SLICE-227-2: plan create guards, milestone lifecycle, leg templates,
 * agreement read view. Memory bundle — PG parity lives in packages/database.
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { Database } from "@agentbadge/database";

import {
  approveMilestone,
  createPlan,
  forceApproveMilestone,
  getAgreementView,
  getIntentView,
  isLegalTransition,
  isTerminal,
  raiseDispute,
  reopenMilestone,
  revertApproval,
  submitForReview,
} from "../../src/server/lib/settlement/index.js";
import type { SettlementCtx } from "../../src/server/lib/settlement/index.js";

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
} from "./helpers.js";

let db: Database;
let ctx: SettlementCtx;
beforeEach(() => {
  ({ db, ctx } = freshCtx());
});

describe("state machines", () => {
  it("enforces legal transitions per entity", () => {
    expect(isLegalTransition("milestone", "PENDING", "READY")).toBe(true);
    expect(isLegalTransition("milestone", "PENDING", "RELEASED")).toBe(false);
    expect(isLegalTransition("milestone", "READY", "APPROVED")).toBe(true);
    expect(isLegalTransition("milestone", "DISPUTED", "APPROVED")).toBe(true);
    expect(isLegalTransition("payout_intent", "OPEN", "FROZEN")).toBe(true);
    expect(isLegalTransition("payout_intent", "COMPLETED", "OPEN")).toBe(false);
    expect(isLegalTransition("payout_leg", "FROZEN", "OPEN")).toBe(true);
    expect(isLegalTransition("settlement_dispute", "OPEN", "RESOLVED")).toBe(
      true,
    );
    expect(isLegalTransition("settlement_anchor", "FAILED", "PENDING")).toBe(
      true,
    );
    expect(isLegalTransition("settlement_anchor", "ANCHORED", "PENDING")).toBe(
      false,
    );
  });

  it("marks terminal statuses", () => {
    expect(isTerminal("milestone", "RELEASED")).toBe(true);
    expect(isTerminal("milestone", "APPROVED")).toBe(false);
    expect(isTerminal("payout_intent", "COMPLETED")).toBe(true);
    expect(isTerminal("settlement_plan", "DISPUTED")).toBe(false);
  });
});

describe("createPlan", () => {
  it("creates an ACTIVE plan with sequenced PENDING milestones", async () => {
    const { plan, milestones, duplicate } = await openPlan(ctx);
    expect(plan.status).toBe("ACTIVE");
    expect(duplicate).toBe(false);
    expect(milestones.map((m) => m.seq)).toEqual([0, 1]);
    expect(milestones.every((m) => m.status === "PENDING")).toBe(true);
  });

  it("rejects a milestone sum that differs from totalUsd", async () => {
    const r = await createPlan(
      ctx,
      {
        agreementRef: "agr-sum",
        buyerWallet: BUYER,
        providerWallet: PROVIDER,
        totalUsd: "10.00",
        milestones: [
          { milestoneId: "m1", title: "a", amountUsd: "6.00" },
          { milestoneId: "m2", title: "b", amountUsd: "3.00" },
        ],
      },
      BUYER,
    );
    expect(codeOf(r)).toBe("BAD_INPUT");
  });

  it("rejects non-decimal and float amounts", async () => {
    for (const totalUsd of ["abc", "1e3", "10.5.2"]) {
      const r = await createPlan(
        ctx,
        {
          agreementRef: `agr-${totalUsd}`,
          buyerWallet: BUYER,
          providerWallet: PROVIDER,
          totalUsd,
          milestones: [{ milestoneId: "m1", title: "a", amountUsd: totalUsd }],
        },
        BUYER,
      );
      expect(codeOf(r)).toBe("BAD_INPUT");
    }
  });

  it("rejects a non-participant creator", async () => {
    const r = await createPlan(
      ctx,
      {
        agreementRef: "agr-stranger",
        buyerWallet: BUYER,
        providerWallet: PROVIDER,
        totalUsd: "1.00",
        milestones: [{ milestoneId: "m1", title: "a", amountUsd: "1.00" }],
      },
      STRANGER,
    );
    expect(codeOf(r)).toBe("FORBIDDEN");
  });

  it("dedupes on agreementRef — second create returns the winner", async () => {
    const input = {
      agreementRef: "agr-dedupe",
      buyerWallet: BUYER,
      providerWallet: PROVIDER,
      totalUsd: "5.00",
      milestones: [{ milestoneId: "m1", title: "a", amountUsd: "5.00" }],
    };
    const first = await createPlan(ctx, input, BUYER);
    const second = await createPlan(ctx, input, PROVIDER);
    expect(first.ok && second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(second.value.duplicate).toBe(true);
      expect(second.value.plan.id).toBe(first.value.plan.id);
    }
  });

  // R2-H1: dedupe compares the full milestone vector, not just the
  // header — a squat plan with matching parties/total but forged
  // milestone ids, policy, or leg payees must CONFLICT, never be
  // silently adopted by ensurePlan.
  it("conflicts a same-header duplicate whose milestone terms differ", async () => {
    const base = {
      agreementRef: "agr-vector",
      buyerWallet: BUYER,
      providerWallet: PROVIDER,
      totalUsd: "10.00",
    };
    const first = await createPlan(
      ctx,
      {
        ...base,
        milestones: [
          { milestoneId: "m1", title: "a", amountUsd: "7.50" },
          { milestoneId: "m2", title: "b", amountUsd: "2.50" },
        ],
      },
      BUYER,
    );
    expect(first.ok).toBe(true);

    const forgedIds = await createPlan(
      ctx,
      {
        ...base,
        milestones: [{ milestoneId: "zzz", title: "a", amountUsd: "10.00" }],
      },
      PROVIDER,
    );
    expect(codeOf(forgedIds)).toBe("CONFLICT");

    const forgedLegs = await createPlan(
      ctx,
      {
        ...base,
        milestones: [
          {
            milestoneId: "m1",
            title: "a",
            amountUsd: "7.50",
            legs: [
              { payee: STRANGER, amountUsdc: "7.50", role: "PROVIDER" as const },
            ],
          },
          { milestoneId: "m2", title: "b", amountUsd: "2.50" },
        ],
      },
      PROVIDER,
    );
    expect(codeOf(forgedLegs)).toBe("CONFLICT");

    // Identical vector still dedupes fine.
    const same = await createPlan(
      ctx,
      {
        ...base,
        milestones: [
          { milestoneId: "m1", title: "a", amountUsd: "7.50" },
          { milestoneId: "m2", title: "b", amountUsd: "2.50" },
        ],
      },
      PROVIDER,
    );
    expect(same.ok && same.value.duplicate).toBe(true);
  });
});

describe("milestone lifecycle", () => {
  it("provider-only submitForReview → READY", async () => {
    const { milestones } = await openPlan(ctx);
    const m = milestones[0]!;
    const denied = await submitForReview(ctx, { milestoneRowId: m.id }, BUYER);
    expect(codeOf(denied)).toBe("FORBIDDEN");
    const ready = await submitForReview(ctx, { milestoneRowId: m.id }, PROVIDER);
    expect(ready.ok && ready.value.status).toBe("READY");
  });

  it("buyer-only approve; PENDING cannot skip READY", async () => {
    const { milestones } = await openPlan(ctx);
    const m = milestones[0]!;
    const early = await approveMilestone(ctx, m.id, BUYER);
    expect(codeOf(early)).toBe("INVALID_STATE");
    await submitForReview(ctx, { milestoneRowId: m.id }, PROVIDER);
    const wrong = await approveMilestone(ctx, m.id, PROVIDER);
    expect(codeOf(wrong)).toBe("FORBIDDEN");
  });

  it("approve creates one default PROVIDER leg for the full amount", async () => {
    const { intentId, legs } = await approvedIntent(ctx);
    const view = await getIntentView(ctx, intentId);
    expect(view?.intent.status).toBe("OPEN");
    expect(view?.intent.milestoneRef).toBeTruthy();
    expect(legs).toHaveLength(1);
    const rows = await db.settlement.payoutLegs.listByIntent(intentId);
    expect(rows[0]!.payee.toLowerCase()).toBe(PROVIDER.toLowerCase());
    expect(rows[0]!.amountUsdc).toBe("7.5");
    expect(rows[0]!.role).toBe("PROVIDER");
    expect(rows[0]!.status).toBe("OPEN");
  });

  it("honours a split-leg template from plan create", async () => {
    const { milestones } = await openPlan(ctx, [
      {
        milestoneId: "m1",
        title: "split work",
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
    expect(ap.ok).toBe(true);
    if (!ap.ok) return;
    const rows = await db.settlement.payoutLegs.listByIntent(ap.value.intentId);
    expect(rows).toHaveLength(2);
    expect(rows.map((l) => l.role).sort()).toEqual([
      "PLATFORM_FEE",
      "PROVIDER",
    ]);
    expect(rows.find((l) => l.role === "PLATFORM_FEE")?.payee).toBe(FEE);
  });
});

describe("agreement view", () => {
  it("aggregates plan + milestones + intents + disputes", async () => {
    const { plan } = await openPlan(ctx);
    const view = await getAgreementView(ctx, plan.agreementRef);
    expect(view?.plan.id).toBe(plan.id);
    expect(view?.milestones).toHaveLength(2);
    expect(view?.intents).toHaveLength(0);
    expect(view?.disputes).toHaveLength(0);
  });
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
