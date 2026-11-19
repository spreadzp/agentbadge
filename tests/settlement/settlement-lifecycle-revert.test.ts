/**
 * SLICE-227-8: R6 audit regressions — approval-epoch revert pin,
 * reopen leg isolation, force bounds, reopen guards. Split from
 * settlement-lifecycle-force.test.ts under the staged-file token cap.
 * Memory bundle — PG parity lives in packages/database.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@agentbadge/database";

import {
  approveMilestone,
  forceApproveMilestone,
  forceReleaseMilestone,
  forceReopenMilestone,
  markLegPaid,
  raiseDispute,
  reopenMilestone,
  resolveDispute,
  revertApproval,
  submitForReview,
} from "../../src/server/lib/settlement/index.js";
import type { SettlementCtx } from "../../src/server/lib/settlement/index.js";
import { SettlementEventEmitter } from "../../src/server/lib/settlement/events.js";

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

describe("R6: approval epoch + revert guards + force bounds", () => {
  it("revert is refused on a stale approval token (R6-M2)", async () => {
    const { milestones } = await openPlan(ctx);
    const m = milestones[0]!;
    await submitForReview(ctx, { milestoneRowId: m.id }, PROVIDER);
    const ap = await approveMilestone(ctx, m.id, BUYER);
    expect(ap.ok).toBe(true);
    if (!ap.ok) return;
    expect(ap.value.approvalToken).toMatch(/^appr_/);
    expect(
      (await db.settlement.milestones.getById(m.id))?.escrowRef,
    ).toBe(ap.value.approvalToken);
    // A stale token means a different approval cycle owns the row.
    const wrong = await revertApproval(ctx, m.id, BUYER, {
      approvalToken: "appr_stale",
    });
    expect(wrong.ok && wrong.value.reverted === false).toBe(true);
    expect(
      (await db.settlement.milestones.getById(m.id))?.status,
    ).toBe("APPROVED");
    // The matching token reverts — and clears the epoch.
    const right = await revertApproval(ctx, m.id, BUYER, {
      approvalToken: ap.value.approvalToken,
    });
    expect(right.ok && right.value.reverted).toBe(true);
    const after = await db.settlement.milestones.getById(m.id);
    expect(after?.status).toBe("READY");
    expect(after?.escrowRef).toBeNull();
  });

  it("revert refuses a FROZEN intent (R6 nit 3)", async () => {
    const { milestones } = await openPlan(ctx);
    const m = milestones[0]!;
    await submitForReview(ctx, { milestoneRowId: m.id }, PROVIDER);
    await approveMilestone(ctx, m.id, BUYER);
    const intent = await db.settlement.payoutIntents.getByMilestone(m.id);
    // A freeze path that failed to mark the milestone DISPUTED leaves
    // APPROVED + FROZEN — the dispute owns that intent, not the gate.
    await db.settlement.payoutIntents.applyStatus(
      intent!.id,
      "OPEN",
      "FROZEN",
    );
    const r = await revertApproval(ctx, m.id, BUYER);
    expect(r.ok && r.value.reverted === false).toBe(true);
    expect(
      (await db.settlement.milestones.getById(m.id))?.status,
    ).toBe("APPROVED");
    expect(
      (await db.settlement.payoutIntents.getById(intent!.id))?.status,
    ).toBe("FROZEN");
  });

  it("forceApproveMilestone binds the reason + submissionRef caps (R6-M3/nit 5/6)", async () => {
    const { milestones } = await openPlan(ctx);
    const m = milestones[0]!;
    await submitForReview(ctx, { milestoneRowId: m.id }, PROVIDER);
    // >2000 serialized bytes — would push the forensic fields out of
    // the 4 KB audit row.
    const long = await forceApproveMilestone(ctx, m.id, {
      operator: OPS,
      reason: "x".repeat(2100),
    });
    expect(long.ok).toBe(false);
    if (!long.ok) expect(long.error.code).toBe("BAD_INPUT");
    // Zero-width / mark-only reasons are not evidence.
    const invisible = await forceApproveMilestone(ctx, m.id, {
      operator: OPS,
      reason: "​ ​",
    });
    expect(invisible.ok).toBe(false);
    if (!invisible.ok) expect(invisible.error.code).toBe("BAD_INPUT");
    // The submissionRef is bounded in the core, not only at the route.
    const big = await forceApproveMilestone(ctx, m.id, {
      operator: OPS,
      reason: "recovery",
      submissionRef: "s".repeat(300),
    });
    expect(big.ok).toBe(false);
    if (!big.ok) expect(big.error.code).toBe("BAD_INPUT");
    // A sane request still lands.
    const good = await forceApproveMilestone(ctx, m.id, {
      operator: OPS,
      reason: "recovery",
      submissionRef: "sub_9",
    });
    expect(good.ok).toBe(true);
  });

  it("forceReopenMilestone refuses a live OPEN intent (R6 nit 4)", async () => {
    const { milestones } = await openPlan(ctx);
    const m = milestones[0]!;
    await submitForReview(ctx, { milestoneRowId: m.id }, PROVIDER);
    await approveMilestone(ctx, m.id, BUYER);
    await revertApproval(ctx, m.id, BUYER);
    const intent = await db.settlement.payoutIntents.getByMilestone(m.id);
    // Simulate the bug state nit 4 guards: READY + a payable intent.
    await db.settlement.payoutIntents.applyStatus(
      intent!.id,
      "CANCELLED",
      "OPEN",
    );
    const r = await forceReopenMilestone(ctx, m.id, {
      operator: OPS,
      reason: "check",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("INVALID_STATE");
    expect(
      (await db.settlement.milestones.getById(m.id))?.status,
    ).toBe("READY");
  });

  it("reopenMilestone compare-and-release skips a foreign binding (R6 nit 9)", async () => {
    const { milestones } = await openPlan(ctx);
    const m = milestones[0]!;
    await submitForReview(
      ctx,
      { milestoneRowId: m.id, submissionRef: "sub_A" },
      PROVIDER,
    );
    // A stale release names a different submission — the newer
    // binding survives.
    const foreign = await reopenMilestone(ctx, m.id, BUYER, {
      expectedSubmissionRef: "sub_B",
    });
    expect(foreign.ok).toBe(true);
    const still = await db.settlement.milestones.getById(m.id);
    expect(still?.status).toBe("READY");
    expect(still?.submissionRef).toBe("sub_A");
    // The matching release unbinds.
    const own = await reopenMilestone(ctx, m.id, BUYER, {
      expectedSubmissionRef: "sub_A",
    });
    expect(own.ok).toBe(true);
    const after = await db.settlement.milestones.getById(m.id);
    expect(after?.status).toBe("PENDING");
    expect(after?.submissionRef).toBeNull();
  });
});

describe("R7: restore epochs + release coverage", () => {
  it("FOR_PROVIDER restore re-stamps the epoch — stale revert refused", async () => {
    const { milestone, intentId } = await approvedIntent(ctx);
    const m = milestone;
    const token = (await db.settlement.milestones.getById(m.id))!.escrowRef;
    expect(token).toMatch(/^appr_/);
    const d = await raiseDispute(ctx, {
      subjectType: "MILESTONE",
      subjectRef: m.id,
      raisedBy: BUYER,
      reason: "hold the payout",
    });
    expect(d.ok).toBe(true);
    if (!d.ok) return;
    const res = await resolveDispute(ctx, {
      disputeId: d.value.dispute.id,
      operator: OPS,
      resolution: "FOR_PROVIDER",
      note: "work stands",
    });
    expect(res.ok).toBe(true);
    const after = await db.settlement.milestones.getById(m.id);
    // Restored to APPROVED — but the epoch belongs to the RESOLVER's
    // cycle now, so the original gate token can no longer revert it.
    // R8-M1: resolver epochs carry the `rsv_` prefix.
    expect(after?.status).toBe("APPROVED");
    expect(after?.escrowRef).toMatch(/^rsv_/);
    expect(after?.escrowRef).not.toBe(token);
    const stale = await revertApproval(ctx, m.id, BUYER, {
      intentId,
      approvalToken: token ?? undefined,
    });
    // R8-M2: refusals carry a reason code — callers can tell a benign
    // stale-epoch no-op from a dangerous paid-leg/intent-state block.
    expect(
      stale.ok &&
        stale.value.reverted === false &&
        stale.value.reason === "epoch_mismatch",
    ).toBe(true);
    expect(
      (await db.settlement.payoutIntents.getById(intentId))?.status,
    ).toBe("OPEN");
  });

  it("SPLIT restore re-stamps the epoch too", async () => {
    const { milestone } = await approvedIntent(ctx);
    const m = milestone;
    const token = (await db.settlement.milestones.getById(m.id))!.escrowRef;
    const d = await raiseDispute(ctx, {
      subjectType: "MILESTONE",
      subjectRef: m.id,
      raisedBy: BUYER,
      reason: "dispute the split",
    });
    expect(d.ok).toBe(true);
    if (!d.ok) return;
    const res = await resolveDispute(ctx, {
      disputeId: d.value.dispute.id,
      operator: OPS,
      resolution: "SPLIT",
      splitLegs: [
        { payee: PROVIDER, amountUsdc: "5.00", role: "PROVIDER" },
        { payee: FEE, amountUsdc: "2.50", role: "PLATFORM_FEE" },
      ],
      note: "60/40",
    });
    expect(res.ok).toBe(true);
    const after = await db.settlement.milestones.getById(m.id);
    expect(after?.status).toBe("APPROVED");
    // R8-M1: a SPLIT-restored approval is resolver-owned (`rsv_`).
    expect(after?.escrowRef).toMatch(/^rsv_/);
    expect(after?.escrowRef).not.toBe(token);
  });
});

describe("R7-M3: emitter stream poisoning on a hung append", () => {
  it("a hung append poisons the stream after one grace window", async () => {
    vi.useFakeTimers();
    try {
      // The store call never settles — both listByEntity and append.
      const store = {
        listByEntity: () => Promise.resolve([]),
        append: () => new Promise(() => {}),
      };
      const em = new SettlementEventEmitter(
        store as never,
      );
      const input = {
        entityType: "milestone" as const,
        entityId: "ms_1",
        eventType: "milestone.test",
      };
      // First emit: append hangs, times out at 15s — stream marked stale.
      const p1 = em.emit(input);
      await vi.advanceTimersByTimeAsync(15001);
      await expect(p1).resolves.toBeNull();
      // Second emit: waits for the stale append — one 15s grace window,
      // then the stream is permanently poisoned.
      const p2 = em.emit(input);
      await vi.advanceTimersByTimeAsync(15001);
      await expect(p2).resolves.toBeNull();
      // Third emit: skipped immediately — the shared queue never stalls.
      const p3 = em.emit(input);
      await expect(p3).resolves.toBeNull();
      // ...and other entity streams keep working.
      const other = em.emit({ ...input, entityId: "ms_2" });
      await vi.advanceTimersByTimeAsync(15001);
      await expect(other).resolves.toBeNull(); // its append also hangs,
      // but only ITS stream pays — the queue itself stayed live.
    } finally {
      vi.useRealTimers();
    }
  });

  it("R8-M3: the poison lifts once the hung append finally settles", async () => {
    vi.useFakeTimers();
    try {
      // The first append hangs until we release it; later appends land.
      let release!: (v: unknown) => void;
      const hung = new Promise((r) => {
        release = r;
      });
      const row = { id: "evt_x", hash: "h", prevHash: "g" };
      let calls = 0;
      const store = {
        listByEntity: () => Promise.resolve([]),
        append: () => (calls++ === 0 ? hung : Promise.resolve(row)),
      };
      const em = new SettlementEventEmitter(store as never);
      const input = {
        entityType: "milestone" as const,
        entityId: "ms_1",
        eventType: "milestone.test",
      };
      const p1 = em.emit(input);
      await vi.advanceTimersByTimeAsync(15001);
      await expect(p1).resolves.toBeNull();
      const p2 = em.emit(input);
      await vi.advanceTimersByTimeAsync(15001);
      await expect(p2).resolves.toBeNull();
      // Third emit is skipped — the stream is poisoned...
      const p3 = em.emit(input);
      await expect(p3).resolves.toBeNull();
      // ...until the hung append actually settles (PG failover that
      // eventually returns). Then the next emit re-reads the tail and
      // lands its row — the stream recovers without a restart.
      release(row);
      await vi.advanceTimersByTimeAsync(0);
      await expect(em.emit(input)).resolves.toEqual(row);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("R10: real-service revert reasons + release guards", () => {
  it("revert on a RELEASED milestone returns reason 'released'", async () => {
    const { milestone, intentId, legs } = await approvedIntent(ctx);
    const paid = await markLegPaid(ctx, {
      intentId,
      legId: legs[0]!,
      txHash: TX1,
      operator: OPS,
    });
    expect(paid.ok).toBe(true);
    expect(
      (await db.settlement.milestones.getById(milestone.id))?.status,
    ).toBe("RELEASED");
    const res = await revertApproval(ctx, milestone.id, BUYER, {
      release: true,
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.reverted).toBe(false);
      expect(res.value.reason).toBe("released");
    }
  });

  it("partial multi-leg payout returns reason 'paid_leg' (milestone still APPROVED)", async () => {
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
    const paid = await markLegPaid(ctx, {
      intentId: ap.value.intentId,
      legId: rows[0]!.id,
      txHash: TX1,
      operator: OPS,
    });
    expect(paid.ok).toBe(true);
    // One leg paid, one open — milestone stays APPROVED but money moved.
    expect(
      (await db.settlement.milestones.getById(m.id))?.status,
    ).toBe("APPROVED");
    const res = await revertApproval(ctx, m.id, BUYER, { release: true });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.reverted).toBe(false);
      expect(res.value.reason).toBe("paid_leg");
    }
  });

  it("a FROZEN intent returns reason 'intent_state' and force-release maps it to INVALID_STATE", async () => {
    const { milestone, intentId } = await approvedIntent(ctx);
    const frozen = await db.settlement.payoutIntents.applyStatus(
      intentId,
      "OPEN",
      "FROZEN",
    );
    expect(frozen).toBeTruthy();
    const res = await revertApproval(ctx, milestone.id, BUYER, {
      release: true,
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.reverted).toBe(false);
      expect(res.value.reason).toBe("intent_state");
    }
    // R10-M3: the in-atomic refusal surfaces as a typed failure — not
    // a 200 `{released:false}` — and mints no audit row.
    const before = await db.finops.adminActions.list({
      subjectType: "milestone",
    });
    const rel = await forceReleaseMilestone(ctx, milestone.id, {
      operator: OPS,
      reason: "undo a frozen ruling",
    });
    expect(rel.ok).toBe(false);
    if (!rel.ok) {
      expect(rel.error.code).toBe("INVALID_STATE");
      expect(rel.error.message).toContain("intent_state");
    }
    const after = await db.finops.adminActions.list({
      subjectType: "milestone",
    });
    expect(
      after.filter((a) => a.action === "FORCE_RELEASE_MILESTONE").length,
    ).toBe(before.length);
    expect(
      (await db.settlement.milestones.getById(milestone.id))?.status,
    ).toBe("APPROVED");
    expect(
      (await db.settlement.payoutIntents.getById(intentId))?.status,
    ).toBe("FROZEN");
  });

  it("force-release emits operator-labelled events (admin:true + operator_release)", async () => {
    const { milestone, intentId } = await approvedIntent(ctx);
    const rel = await forceReleaseMilestone(ctx, milestone.id, {
      operator: OPS,
      reason: "undo the ruling",
    });
    expect(rel.ok).toBe(true);
    const msEvents = await db.commerce.events.listByEntity(
      "milestone",
      milestone.id,
    );
    const pending = msEvents.find((e) => e.eventType === "milestone.pending");
    expect(pending?.payload).toMatchObject({
      reason: "operator_release",
      admin: true,
    });
    const piEvents = await db.commerce.events.listByEntity(
      "payout_intent",
      intentId,
    );
    const cancelled = piEvents.find((e) => e.eventType === "intent.cancelled");
    expect(cancelled?.payload).toMatchObject({
      reason: "operator_release",
      admin: true,
    });
  });
});

