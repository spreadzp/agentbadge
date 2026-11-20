/**
 * SLICE-227-8: R11 audit regressions — the release/reopen agreement
 * guard (fail-closed reads, gate-in-flight window, DISPUTED allowed,
 * reopen mirror). Split from settlement-lifecycle-revert.test.ts
 * under the staged-file token cap. Memory bundle — PG parity lives
 * in deploy/database.
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { Database } from "@agentbadge/database";

import {
  approveMilestone,
  forceApproveMilestone,
  forceReleaseMilestone,
  markLegPaid,
  submitForReview,
} from "../../src/server/lib/settlement/index.js";
import type { SettlementCtx } from "../../src/server/lib/settlement/index.js";

import {
  approvedIntent,
  BUYER,
  FEE,
  freshCtx,
  openPlan,
  OPS,
  PROVIDER,
  TX1,
} from "./helpers.js";

let db: Database;
let ctx: SettlementCtx;
beforeEach(() => {
  ({ db, ctx } = freshCtx());
});

describe("R11/R12: agreement/submission guard for release+reopen", () => {
  const patchAgreements = (row: { status: string } | null) => {
    const store = ctx.db.commerce.agreements;
    const orig = store.getById.bind(store);
    store.getById = (async () => row) as never;
    return () => {
      store.getById = orig;
    };
  };
  const patchSubmissions = (fn: () => Promise<unknown>) => {
    const store = ctx.db.commerce.submissions;
    const orig = store.getById.bind(store);
    store.getById = fn as never;
    return () => {
      store.getById = orig;
    };
  };

  it("R13-M2: COMPLETED agreement refuses without confirmCancel (owed payout)", async () => {
    const { milestone } = await approvedIntent(ctx);
    const restore = patchAgreements({ status: "COMPLETED" });
    const rel = await forceReleaseMilestone(ctx, milestone.id, {
      operator: OPS,
      reason: "undo ruling",
    });
    expect(rel.ok).toBe(false);
    if (!rel.ok) {
      expect(rel.error.code).toBe("INVALID_STATE");
      expect(rel.error.details?.reason).toBe(
        "would_cancel_approved_payout",
      );
      expect(rel.error.details?.intentId).toBeTruthy();
    }
    restore();
    // Nothing moved — the owed payout stands.
    expect(
      (await db.settlement.milestones.getById(milestone.id))?.status,
    ).toBe("APPROVED");
  });

  it("R12-M1+R13-M2: COMPLETED + confirmCancel → CANCELLED cleanup", async () => {
    const { milestone, intentId } = await approvedIntent(ctx);
    const restore = patchAgreements({ status: "COMPLETED" });
    const rel = await forceReleaseMilestone(ctx, milestone.id, {
      operator: OPS,
      reason: "undo ruling",
      confirmCancel: true,
    });
    expect(rel.ok).toBe(true);
    if (rel.ok) {
      expect(rel.value.released).toBe(true);
      expect(rel.value.cancelled).toBe(true);
      expect(rel.value.auditRecorded).toBe(true);
    }
    restore();
    expect(
      (await db.settlement.milestones.getById(milestone.id))?.status,
    ).toBe("CANCELLED");
    expect(
      (await db.settlement.payoutIntents.getById(intentId))?.status,
    ).toBe("CANCELLED");
  });

  it("R13-M2: CANCELLED agreement auto-cancels (nothing owed)", async () => {
    const { milestone } = await approvedIntent(ctx);
    const restore = patchAgreements({ status: "CANCELLED" });
    const rel = await forceReleaseMilestone(ctx, milestone.id, {
      operator: OPS,
      reason: "undo ruling",
    });
    expect(rel.ok).toBe(true);
    if (rel.ok) expect(rel.value.cancelled).toBe(true);
    restore();
    expect(
      (await db.settlement.milestones.getById(milestone.id))?.status,
    ).toBe("CANCELLED");
  });

  it("missing commerce row = pure-settlement plan → release lands", async () => {
    const { milestone } = await approvedIntent(ctx);
    const rel = await forceReleaseMilestone(ctx, milestone.id, {
      operator: OPS,
      reason: "undo ruling",
    });
    expect(rel.ok).toBe(true);
    if (rel.ok) expect(rel.value.released).toBe(true);
    expect(
      (await db.settlement.milestones.getById(milestone.id))?.status,
    ).toBe("PENDING");
  });

  it("DISPUTED agreement does not block the release (nit 3)", async () => {
    const { milestone } = await approvedIntent(ctx);
    const restore = patchAgreements({ status: "DISPUTED" });
    const rel = await forceReleaseMilestone(ctx, milestone.id, {
      operator: OPS,
      reason: "undo ruling",
    });
    expect(rel.ok).toBe(true);
    restore();
  });

  it("a throwing agreement read fails CLOSED (PROVIDER_ERROR), not open", async () => {
    const { milestone } = await approvedIntent(ctx);
    ctx.db.commerce.agreements.getById = (() =>
      Promise.reject(new Error("pool exhausted"))) as never;
    const rel = await forceReleaseMilestone(ctx, milestone.id, {
      operator: OPS,
      reason: "undo ruling",
    });
    expect(rel.ok).toBe(false);
    if (!rel.ok) expect(rel.error.code).toBe("PROVIDER_ERROR");
    expect(
      (await db.settlement.milestones.getById(milestone.id))?.status,
    ).toBe("APPROVED");
  });

  it("R12-H1: an OWNED still-SUBMITTED binding under appr_ refuses (in-flight verdict)", async () => {
    const { plan, milestone } = await approvedIntent(ctx);
    const restore = patchSubmissions(() =>
      Promise.resolve({
        status: "SUBMITTED",
        agreementId: plan.agreementRef,
        milestoneRef: milestone.milestoneId,
      }),
    );
    const rel = await forceReleaseMilestone(ctx, milestone.id, {
      operator: OPS,
      reason: "undo ruling",
    });
    expect(rel.ok).toBe(false);
    if (!rel.ok) {
      expect(rel.error.code).toBe("INVALID_STATE");
      expect(rel.error.details?.reason).toBe("gate_in_flight");
    }
    restore();
  });

  it("R12-H1: a FOREIGN still-SUBMITTED binding cannot lock the exit", async () => {
    const { milestone } = await approvedIntent(ctx);
    // Bound ref resolves to a SUBMITTED row of ANOTHER agreement —
    // provider-forged lock attempt: the release must land anyway.
    const restore = patchSubmissions(() =>
      Promise.resolve({
        status: "SUBMITTED",
        agreementId: "agr-foreign",
        milestoneRef: "m-foreign",
      }),
    );
    const rel = await forceReleaseMilestone(ctx, milestone.id, {
      operator: OPS,
      reason: "undo ruling",
    });
    expect(rel.ok).toBe(true);
    restore();
    expect(
      (await db.settlement.milestones.getById(milestone.id))?.status,
    ).toBe("PENDING");
  });

  it("R12-H1: an owned SUBMITTED row does NOT lock an ops_ epoch", async () => {
    // Operator force-approved while the commerce submission is still
    // SUBMITTED (buyer unreachable) — the guard must not deadlock the
    // operator's own undo on a gate that is not in flight.
    const { plan, milestones } = await openPlan(ctx);
    const m = milestones[0]!;
    await submitForReview(
      ctx,
      { milestoneRowId: m.id, submissionRef: "sub-1" },
      PROVIDER,
    );
    const fa = await forceApproveMilestone(ctx, m.id, {
      operator: OPS,
      reason: "buyer gone",
    });
    expect(fa.ok).toBe(true);
    const restore = patchSubmissions(() =>
      Promise.resolve({
        status: "SUBMITTED",
        agreementId: plan.agreementRef,
        milestoneRef: m.milestoneId,
      }),
    );
    const rel = await forceReleaseMilestone(ctx, m.id, {
      operator: OPS,
      reason: "undo my own force-approve",
    });
    expect(rel.ok).toBe(true);
    restore();
    expect(
      (await db.settlement.milestones.getById(m.id))?.status,
    ).toBe("PENDING");
  });

  it("R12 self-review: terminal agreement + stale owned SUBMITTED → cancel wins (no deadlock)", async () => {
    // The submission stays SUBMITTED under a COMPLETED agreement — its
    // verdict can never land, so gate_in_flight must NOT lock the
    // cancel cleanup. Ordering regression for the deferred refusal.
    const { plan, milestone } = await approvedIntent(ctx);
    const restoreSub = patchSubmissions(() =>
      Promise.resolve({
        status: "SUBMITTED",
        agreementId: plan.agreementRef,
        milestoneRef: milestone.milestoneId,
      }),
    );
    const restoreAgr = patchAgreements({ status: "COMPLETED" });
    const rel = await forceReleaseMilestone(ctx, milestone.id, {
      operator: OPS,
      reason: "cleanup under closed agreement",
      confirmCancel: true,
    });
    expect(rel.ok).toBe(true);
    if (rel.ok) expect(rel.value.cancelled).toBe(true);
    restoreAgr();
    restoreSub();
    expect(
      (await db.settlement.milestones.getById(milestone.id))?.status,
    ).toBe("CANCELLED");
  });

  it("a throwing submission read fails CLOSED too", async () => {
    const { milestone } = await approvedIntent(ctx);
    const restore = patchSubmissions(() =>
      Promise.reject(new Error("statement timeout")),
    );
    const rel = await forceReleaseMilestone(ctx, milestone.id, {
      operator: OPS,
      reason: "undo ruling",
    });
    expect(rel.ok).toBe(false);
    if (!rel.ok) expect(rel.error.code).toBe("PROVIDER_ERROR");
    restore();
  });

  it("paid_leg refusal reaches forceReleaseMilestone as INVALID_STATE + details.reason", async () => {
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
    const rows = await db.settlement.payoutLegs.listByIntent(
      ap.value.intentId,
    );
    await markLegPaid(ctx, {
      intentId: ap.value.intentId,
      legId: rows[0]!.id,
      txHash: TX1,
      operator: OPS,
    });
    const rel = await forceReleaseMilestone(ctx, m.id, {
      operator: OPS,
      reason: "undo ruling",
    });
    expect(rel.ok).toBe(false);
    if (!rel.ok) {
      expect(rel.error.code).toBe("INVALID_STATE");
      expect(rel.error.details?.reason).toBe("paid_leg");
    }
  });

  it("R13-M3: dormant owned SUBMITTED + live agreement → acknowledgeInFlight unlocks", async () => {
    // Buyer approved directly via approveMilestone — the appr_ epoch
    // minted but the commerce submission sits SUBMITTED indefinitely
    // (no verdict ever arrives). The gate locks without the audited
    // override; with it the release lands.
    const { plan, milestone } = await approvedIntent(ctx);
    const restore = patchSubmissions(() =>
      Promise.resolve({
        status: "SUBMITTED",
        agreementId: plan.agreementRef,
        milestoneRef: milestone.milestoneId,
      }),
    );
    const locked = await forceReleaseMilestone(ctx, milestone.id, {
      operator: OPS,
      reason: "undo ruling",
    });
    expect(locked.ok).toBe(false);
    if (!locked.ok) {
      expect(locked.error.details?.reason).toBe("gate_in_flight");
    }
    const rel = await forceReleaseMilestone(ctx, milestone.id, {
      operator: OPS,
      reason: "undo ruling — verdict is dormant",
      acknowledgeInFlight: true,
    });
    expect(rel.ok).toBe(true);
    restore();
    expect(
      (await db.settlement.milestones.getById(milestone.id))?.status,
    ).toBe("PENDING");
  });

  it("R14-M1: ack-release reports verdictLanded when an ACCEPT lands behind it", async () => {
    // Guard sees owned SUBMITTED; ack override releases; by the
    // post-check the verdict committed ACCEPTED → accepted work with
    // no payable intent must surface, not a clean 200.
    const { plan, milestone } = await approvedIntent(ctx);
    let calls = 0;
    const restore = patchSubmissions(() => {
      calls += 1;
      return Promise.resolve({
        status: calls === 1 ? "SUBMITTED" : "ACCEPTED",
        agreementId: plan.agreementRef,
        milestoneRef: milestone.milestoneId,
      });
    });
    const rel = await forceReleaseMilestone(ctx, milestone.id, {
      operator: OPS,
      reason: "beat the dormant gate",
      acknowledgeInFlight: true,
    });
    expect(rel.ok).toBe(true);
    if (rel.ok) {
      expect(rel.value.released).toBe(true);
      expect(rel.value.verdictLanded).toBe(true);
    }
    restore();
    // R15-N9: response and audit evidence agree.
    const actions = await db.finops.adminActions.list({
      subjectType: "milestone",
    });
    const mine = actions.find((a) => a.subjectId === milestone.id);
    expect(
      (mine?.evidence as Record<string, unknown> | undefined)
        ?.verdictLanded,
    ).toBe(true);
    expect(
      (await db.settlement.milestones.getById(milestone.id))?.status,
    ).toBe("PENDING");
  });

  it("R15-N2: ack flag on a bound ACCEPTED row (no gate) does NOT flag verdictLanded", async () => {
    // The deliberate un-accept: milestone bound to an already-ACCEPTED
    // submission — no gate was in flight, so ackOverrode is false and
    // the post-check must not run at all.
    const { plan, milestone } = await approvedIntent(ctx);
    let calls = 0;
    const restore = patchSubmissions(() => {
      calls += 1;
      return Promise.resolve({
        status: "ACCEPTED",
        agreementId: plan.agreementRef,
        milestoneRef: milestone.milestoneId,
      });
    });
    const rel = await forceReleaseMilestone(ctx, milestone.id, {
      operator: OPS,
      reason: "deliberate un-accept",
      acknowledgeInFlight: true,
    });
    expect(rel.ok).toBe(true);
    if (rel.ok) {
      expect(rel.value.released).toBe(true);
      expect(rel.value.verdictLanded).toBeUndefined();
    }
    restore();
    expect(calls).toBe(1); // guard read only — no post-check read
  });

  it("R15-N4: a failed post-check re-read does not fail the release", async () => {
    const { plan, milestone } = await approvedIntent(ctx);
    let calls = 0;
    const restore = patchSubmissions(() => {
      calls += 1;
      if (calls === 2) return Promise.reject(new Error("db timeout"));
      return Promise.resolve({
        status: "SUBMITTED",
        agreementId: plan.agreementRef,
        milestoneRef: milestone.milestoneId,
      });
    });
    const rel = await forceReleaseMilestone(ctx, milestone.id, {
      operator: OPS,
      reason: "beat the dormant gate",
      acknowledgeInFlight: true,
    });
    expect(rel.ok).toBe(true);
    if (rel.ok) expect(rel.value.verdictLanded).toBeUndefined();
    restore();
  });

});