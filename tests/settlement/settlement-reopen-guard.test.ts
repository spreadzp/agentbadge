/**
 * SLICE-227-8: R12–R15 audit regressions — the forceReopenMilestone
 * guard paths (terminal-agreement cancel cleanup, stranded-READY
 * entitlement refusal, honest transitioned/audit behavior). Split
 * from settlement-release-guard.test.ts under the staged-file token
 * cap. Memory bundle — PG parity lives in deploy/database.
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { Database } from "@agentbadge/database";

import {
  forceReopenMilestone,
  submitForReview,
} from "../../src/server/lib/settlement/index.js";
import type { SettlementCtx } from "../../src/server/lib/settlement/index.js";

import { freshCtx, openPlan, OPS, PROVIDER } from "./helpers.js";

let db: Database;
let ctx: SettlementCtx;
beforeEach(() => {
  ({ db, ctx } = freshCtx());
});

describe("R12–R15: reopen guard", () => {
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
  it("reopen mirrors the guard — COMPLETED agreement → CANCELLED cleanup", async () => {
    const { milestones } = await openPlan(ctx);
    const m = milestones[0]!;
    await submitForReview(ctx, { milestoneRowId: m.id }, PROVIDER);
    const restore = patchAgreements({ status: "COMPLETED" });
    const r = await forceReopenMilestone(ctx, m.id, {
      operator: OPS,
      reason: "free it",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.reopened).toBe(true);
      expect(r.value.cancelled).toBe(true);
    }
    restore();
    expect(
      (await db.settlement.milestones.getById(m.id))?.status,
    ).toBe("CANCELLED");
  });


  it("R14-M2: reopen under COMPLETED + ACCEPTED submission refuses (stranded entitlement → force-approve)", async () => {
    const { plan, milestones } = await openPlan(ctx);
    const m = milestones[0]!;
    await submitForReview(
      ctx,
      { milestoneRowId: m.id, submissionRef: "sub-1" },
      PROVIDER,
    );
    const restoreSub = patchSubmissions(() =>
      Promise.resolve({
        status: "ACCEPTED",
        agreementId: plan.agreementRef,
        milestoneRef: m.milestoneId,
      }),
    );
    const restoreAgr = patchAgreements({ status: "COMPLETED" });
    const r = await forceReopenMilestone(ctx, m.id, {
      operator: OPS,
      reason: "free it",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("INVALID_STATE");
      expect(r.error.details?.reason).toBe("would_cancel_accepted_work");
    }
    restoreAgr();
    restoreSub();
    // Row untouched — force-approve can still pay it.
    expect((await db.settlement.milestones.getById(m.id))?.status).toBe(
      "READY",
    );
  });

  it("R14-M2: reopen under COMPLETED + REJECTED submission still auto-cancels", async () => {
    const { plan, milestones } = await openPlan(ctx);
    const m = milestones[0]!;
    await submitForReview(
      ctx,
      { milestoneRowId: m.id, submissionRef: "sub-1" },
      PROVIDER,
    );
    const restoreSub = patchSubmissions(() =>
      Promise.resolve({
        status: "REJECTED",
        agreementId: plan.agreementRef,
        milestoneRef: m.milestoneId,
      }),
    );
    const restoreAgr = patchAgreements({ status: "COMPLETED" });
    const r = await forceReopenMilestone(ctx, m.id, {
      operator: OPS,
      reason: "free it",
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.cancelled).toBe(true);
    restoreAgr();
    restoreSub();
    // R15-N9: the row actually landed CANCELLED.
    expect((await db.settlement.milestones.getById(m.id))?.status).toBe(
      "CANCELLED",
    );
  });

  it("R15-N1: reopen under COMPLETED + foreign-milestone ACCEPTED submission auto-cancels", async () => {
    // The bound submission is ACCEPTED but belongs to ANOTHER
    // milestone of the same agreement — not this milestone's
    // entitlement. The N1 ownership scoping must NOT over-refuse
    // with would_cancel_accepted_work.
    const { plan, milestones } = await openPlan(ctx);
    const m = milestones[0]!;
    await submitForReview(
      ctx,
      { milestoneRowId: m.id, submissionRef: "sub-1" },
      PROVIDER,
    );
    const restoreSub = patchSubmissions(() =>
      Promise.resolve({
        status: "ACCEPTED",
        agreementId: plan.agreementRef,
        milestoneRef: "m-other",
      }),
    );
    const restoreAgr = patchAgreements({ status: "COMPLETED" });
    const r = await forceReopenMilestone(ctx, m.id, {
      operator: OPS,
      reason: "free it",
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.cancelled).toBe(true);
    restoreAgr();
    restoreSub();
    expect((await db.settlement.milestones.getById(m.id))?.status).toBe(
      "CANCELLED",
    );
  });

  it("R13-M1: reopen mints NO audit when a raced release already landed the target", async () => {
    const { milestones } = await openPlan(ctx);
    const m = milestones[0]!;
    await submitForReview(ctx, { milestoneRowId: m.id }, PROVIDER);
    // The raced reject-release lands PENDING between our pre-read and
    // reopenMilestone's own read — the row already sits AT the target
    // status, so a status-equality check would fake a transition.
    const store = db.settlement.milestones;
    const orig = store.getById.bind(store);
    let reads = 0;
    store.getById = (async (id: string) => {
      reads += 1;
      const row = await orig(id);
      if (reads > 1 && row) {
        return { ...row, status: "PENDING", submissionRef: null };
      }
      return row;
    }) as never;
    const before = await db.finops.adminActions.list({
      subjectType: "milestone",
    });
    const r = await forceReopenMilestone(ctx, m.id, {
      operator: OPS,
      reason: "free it",
    });
    store.getById = orig;
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.reopened).toBe(false);
      expect(r.value.auditRecorded).toBe(false);
    }
    const after = await db.finops.adminActions.list({
      subjectType: "milestone",
    });
    expect(after.length).toBe(before.length);
  });

  it("R12-M2: reopen does not mint an audit row when the row moved in the gap", async () => {
    const { milestones } = await openPlan(ctx);
    const m = milestones[0]!;
    await submitForReview(ctx, { milestoneRowId: m.id }, PROVIDER);
    // The row leaves READY between the guard's pre-read and the
    // reopen's own getById — simulated by flipping the row the second
    // time the store is read.
    const store = db.settlement.milestones;
    const orig = store.getById.bind(store);
    let reads = 0;
    store.getById = (async (id: string) => {
      reads += 1;
      const row = await orig(id);
      if (reads > 1 && row) return { ...row, status: "APPROVED" };
      return row;
    }) as never;
    const before = await db.finops.adminActions.list({
      subjectType: "milestone",
    });
    const r = await forceReopenMilestone(ctx, m.id, {
      operator: OPS,
      reason: "free it",
    });
    store.getById = orig;
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.reopened).toBe(false);
      expect(r.value.auditRecorded).toBe(false);
    }
    const after = await db.finops.adminActions.list({
      subjectType: "milestone",
    });
    expect(after.length).toBe(before.length);
    // And the row itself was not unbound.
    expect((await orig(m.id))?.status).toBe("READY");
  });
});
