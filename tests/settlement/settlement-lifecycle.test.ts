/**
 * SLICE-227-2: plan create guards, milestone lifecycle, leg templates,
 * agreement read view. Memory bundle — PG parity lives in packages/database.
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { Database } from "@agentbadge/database";

import {
  approveMilestone,
  createPlan,
  getAgreementView,
  getIntentView,
  isLegalTransition,
  isTerminal,
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
