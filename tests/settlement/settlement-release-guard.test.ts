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
  forceReleaseMilestone,
  forceReopenMilestone,
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

describe("R11: agreement/submission guard for release+reopen", () => {
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

  it("COMPLETED agreement refuses; DISPUTED and missing rows allow", async () => {
    const { milestone } = await approvedIntent(ctx);
    const restore = patchAgreements({ status: "COMPLETED" });
    const rel = await forceReleaseMilestone(ctx, milestone.id, {
      operator: OPS,
      reason: "undo ruling",
    });
    expect(rel.ok).toBe(false);
    if (!rel.ok) {
      expect(rel.error.code).toBe("INVALID_STATE");
      expect(rel.error.details?.reason).toBe("agreement_not_active");
    }
    restore();
    // A missing commerce row = pure-settlement plan → release lands.
    const ok = await forceReleaseMilestone(ctx, milestone.id, {
      operator: OPS,
      reason: "undo ruling",
    });
    expect(ok.ok).toBe(true);
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

  it("a still-SUBMITTED binding refuses (in-flight verdict window)", async () => {
    const { milestone } = await approvedIntent(ctx);
    const restore = patchSubmissions(() =>
      Promise.resolve({ status: "SUBMITTED" }),
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

  it("reopen mirrors the guard — a COMPLETED agreement refuses", async () => {
    const { milestones } = await openPlan(ctx);
    const m = milestones[0]!;
    await submitForReview(ctx, { milestoneRowId: m.id }, PROVIDER);
    const restore = patchAgreements({ status: "COMPLETED" });
    const r = await forceReopenMilestone(ctx, m.id, {
      operator: OPS,
      reason: "free it",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("INVALID_STATE");
    restore();
  });
});
