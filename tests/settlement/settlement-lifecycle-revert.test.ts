/**
 * SLICE-227-8: R6 audit regressions — approval-epoch revert pin,
 * reopen leg isolation, force bounds, reopen guards. Split from
 * settlement-lifecycle-force.test.ts under the staged-file token cap.
 * Memory bundle — PG parity lives in packages/database.
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { Database } from "@agentbadge/database";

import {
  approveMilestone,
  forceApproveMilestone,
  forceReopenMilestone,
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
