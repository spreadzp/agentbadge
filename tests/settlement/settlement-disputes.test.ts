/**
 * SLICE-227-2: disputes — participant-only raise, freeze of plan/
 * milestone/intent/legs, OPEN-dedupe, operator-only resolve with
 * FOR_PROVIDER restore / FOR_BUYER cancel / SPLIT re-leg. Memory bundle.
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { Database } from "@agentbadge/database";

import {
  getIntentView,
  markLegPaid,
  raiseDispute,
  resolveDispute,
} from "../../src/server/lib/settlement/index.js";
import type { SettlementCtx } from "../../src/server/lib/settlement/index.js";

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

let db: Database;
let ctx: SettlementCtx;
beforeEach(() => {
  ({ db, ctx } = freshCtx());
});

describe("raise", () => {
  it("rejects a non-participant raiser", async () => {
    const { plan } = await openPlan(ctx);
    const r = await raiseDispute(ctx, {
      subjectType: "AGREEMENT",
      subjectRef: plan.agreementRef,
      raisedBy: STRANGER,
      reason: "not my agreement but I object",
    });
    expect(codeOf(r)).toBe("FORBIDDEN");
  });

  it("404s on an unknown subject", async () => {
    const r = await raiseDispute(ctx, {
      subjectType: "AGREEMENT",
      subjectRef: "agr-missing",
      raisedBy: BUYER,
      reason: "ghost",
    });
    expect(codeOf(r)).toBe("NOT_FOUND");
  });

  it("freezes plan, milestone, intent and legs on raise", async () => {
    const { plan, milestone, intentId } = await approvedIntent(ctx);
    const r = await raiseDispute(ctx, {
      subjectType: "MILESTONE",
      subjectRef: milestone.id,
      raisedBy: BUYER,
      reason: "work not delivered as specified",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.frozenIntents).toBe(1);
    expect(r.value.frozenLegs).toBe(1);
    const p = await db.settlement.plans.getById(plan.id);
    expect(p?.status).toBe("DISPUTED");
    const m = await db.settlement.milestones.getById(milestone.id);
    expect(m?.status).toBe("DISPUTED");
    const intent = await getIntentView(ctx, intentId);
    expect(intent?.intent.status).toBe("FROZEN");
    const legs = await db.settlement.payoutLegs.listByIntent(intentId);
    expect(legs[0]!.status).toBe("FROZEN");
  });

  it("dedupes a second OPEN dispute on the same subject", async () => {
    const { plan } = await openPlan(ctx);
    const first = await raiseDispute(ctx, {
      subjectType: "AGREEMENT",
      subjectRef: plan.agreementRef,
      raisedBy: BUYER,
      reason: "first",
    });
    const second = await raiseDispute(ctx, {
      subjectType: "AGREEMENT",
      subjectRef: plan.agreementRef,
      raisedBy: PROVIDER,
      reason: "second",
    });
    expect(second.ok && second.value.duplicate).toBe(true);
    if (first.ok && second.ok) {
      expect(second.value.dispute.id).toBe(first.value.dispute.id);
    }
  });
});

describe("resolve", () => {
  it("requires an operator", async () => {
    const { plan } = await openPlan(ctx);
    const d = await raiseDispute(ctx, {
      subjectType: "AGREEMENT",
      subjectRef: plan.agreementRef,
      raisedBy: BUYER,
      reason: "issue",
    });
    if (!d.ok) throw new Error("raise failed");
    const r = await resolveDispute(ctx, {
      disputeId: d.value.dispute.id,
      operator: "",
      resolution: "FOR_PROVIDER",
    });
    expect(codeOf(r)).toBe("OPERATOR_REQUIRED");
  });

  it("FOR_PROVIDER restores the frozen work to payable", async () => {
    const { plan, milestone, intentId } = await approvedIntent(ctx);
    const d = await raiseDispute(ctx, {
      subjectType: "MILESTONE",
      subjectRef: milestone.id,
      raisedBy: PROVIDER,
      reason: "buyer unresponsive",
    });
    if (!d.ok) throw new Error("raise failed");
    const r = await resolveDispute(ctx, {
      disputeId: d.value.dispute.id,
      operator: OPS,
      resolution: "FOR_PROVIDER",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.dispute.status).toBe("RESOLVED");
    expect(r.value.auditRecorded).toBe(true);
    expect((await db.settlement.plans.getById(plan.id))?.status).toBe("ACTIVE");
    expect((await db.settlement.milestones.getById(milestone.id))?.status).toBe(
      "APPROVED",
    );
    expect((await getIntentView(ctx, intentId))?.intent.status).toBe("OPEN");
    const legs = await db.settlement.payoutLegs.listByIntent(intentId);
    expect(legs[0]!.status).toBe("OPEN");
    const paid = await markLegPaid(ctx, {
      intentId,
      txHash: TX1,
      operator: OPS,
    });
    expect(paid.ok).toBe(true);
  });

  it("FOR_BUYER cancels the milestone, intent and legs", async () => {
    const { plan, milestone, intentId } = await approvedIntent(ctx);
    const d = await raiseDispute(ctx, {
      subjectType: "MILESTONE",
      subjectRef: milestone.id,
      raisedBy: BUYER,
      reason: "never delivered",
    });
    if (!d.ok) throw new Error("raise failed");
    const r = await resolveDispute(ctx, {
      disputeId: d.value.dispute.id,
      operator: OPS,
      resolution: "FOR_BUYER",
    });
    expect(r.ok).toBe(true);
    const m = await db.settlement.milestones.getById(milestone.id);
    expect(m?.status).toBe("CANCELLED");
    const intent = await getIntentView(ctx, intentId);
    expect(intent?.intent.status).toBe("CANCELLED");
    const legs = await db.settlement.payoutLegs.listByIntent(intentId);
    expect(legs[0]!.status).toBe("CANCELLED");
    // The sibling milestone is still PENDING — plan back to ACTIVE.
    expect((await db.settlement.plans.getById(plan.id))?.status).toBe("ACTIVE");
  });

  it("SPLIT re-legs a frozen intent and resumes payout", async () => {
    const { milestone, intentId } = await approvedIntent(ctx);
    const d = await raiseDispute(ctx, {
      subjectType: "MILESTONE",
      subjectRef: milestone.id,
      raisedBy: BUYER,
      reason: "partial delivery — split the payout",
    });
    if (!d.ok) throw new Error("raise failed");
    const r = await resolveDispute(ctx, {
      disputeId: d.value.dispute.id,
      operator: OPS,
      resolution: "SPLIT",
      splitLegs: [
        { payee: PROVIDER, amountUsdc: "5.00", role: "PROVIDER" },
        { payee: BUYER, amountUsdc: "2.50", role: "COLLABORATOR" },
      ],
      note: "buyer keeps 2.50 as refund-in-kind",
    });
    expect(r.ok).toBe(true);
    const legs = await db.settlement.payoutLegs.listByIntent(intentId);
    expect(legs.filter((l) => l.status === "CANCELLED")).toHaveLength(1);
    const open = legs.filter((l) => l.status === "OPEN");
    expect(open).toHaveLength(2);
    expect(open.reduce((a, l) => a + Number(l.amountUsdc), 0)).toBeCloseTo(7.5);
    expect((await getIntentView(ctx, intentId))?.intent.status).toBe("OPEN");
  });

  it("SPLIT without splitLegs is BAD_INPUT", async () => {
    const { milestone } = await approvedIntent(ctx);
    const d = await raiseDispute(ctx, {
      subjectType: "MILESTONE",
      subjectRef: milestone.id,
      raisedBy: BUYER,
      reason: "split me",
    });
    if (!d.ok) throw new Error("raise failed");
    const r = await resolveDispute(ctx, {
      disputeId: d.value.dispute.id,
      operator: OPS,
      resolution: "SPLIT",
    });
    expect(codeOf(r)).toBe("BAD_INPUT");
  });
});
