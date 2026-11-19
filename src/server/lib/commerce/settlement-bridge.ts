/**
 * SLICE-227-5 (EPIC-227): commerce → settlement bridge.
 *
 * One-directional seam (D-227-2): commerce may drive settlement;
 * settlement never imports commerce. The bridge is injected on
 * CommerceCtx — absent → commerce runs exactly as pre-227 (tests
 * stub it; prod wires the real impl from routes/index.ts).
 *
 * Every cross-domain call is POST-COMMIT best-effort: the commerce
 * atomic section never spans settlement stores, so a bridge failure
 * logs and leaves a self-healing seam — ensurePlan is idempotent on
 * agreementRef and retried on every milestone path.
 */
import type { Database } from "@agentbadge/database";
import { logger } from "@agentbadge/passport/logger";

import {
  approveMilestone,
  createPlan,
  createSettlementCtx,
  getPlanByAgreement,
  reopenMilestone,
  revertApproval,
  submitForReview,
  type MilestoneInput,
} from "../settlement/index.js";

export interface SettlementPlanInput {
  agreementId: string;
  buyerWallet: string;
  providerWallet: string;
  /** Decimal string — sum of milestones when given. */
  agreedAmount: string;
  currency?: string | null;
  /** Draft milestones from offer terms; absent → one full-amount. */
  milestones?: MilestoneInput[] | null;
}

export interface CommerceSettlementBridge {
  /** Idempotent — unique agreementRef dedupes; safe to retry. */
  ensurePlan(input: SettlementPlanInput): Promise<void>;
  /**
   * Resolve a caller-chosen milestoneRef (the plan's milestoneId
   * business key) to its row inside THIS agreement's plan —
   * null when the plan or the milestone is absent.
   */
  findMilestone(
    agreementId: string,
    milestoneRef: string,
  ): Promise<{ id: string; status: string } | null>;
  /** Open (PENDING/READY) milestones on the agreement's plan — heals a
   *  missing plan first (R3-H2: used to bind unbound submissions). */
  openMilestones(
    agreementId: string,
  ): Promise<{ rowId: string; ref: string; status: string }[]>;
  /** Provider submits the milestone for review (post-commit). */
  submitMilestone(
    milestoneRowId: string,
    actorWallet: string,
    submissionRef?: string,
  ): Promise<void>;
  /** Buyer approve → APPROVED + payout intent. Returns the raw result —
   *  errors still log (settled) but callers can react (R3-H3). */
  approveMilestone(
    milestoneRowId: string,
    actorWallet: string,
  ): Promise<{
    ok: boolean;
    error?: { code: string; message: string };
    value?: { intentId?: string };
  }>;
  /** R4-H1: undo a pre-commit approve whose verdict never committed —
   *  APPROVED→READY + OPEN intent cancelled. Idempotent.
   *  R5: `intentId` pins the revert to the intent the caller created;
   *  `release` goes straight to PENDING (committed reject verdict). */
  revertApproval(
    milestoneRowId: string,
    actorWallet: string,
    opts?: { intentId?: string; release?: boolean },
  ): Promise<void>;
  /** R4-M5: READY→PENDING + unbind — a rejected submission frees its
   *  milestone for the resubmission round. Idempotent. */
  releaseMilestone(
    milestoneRowId: string,
    actorWallet: string,
  ): Promise<void>;
  /**
   * Milestones in the agreement's plan still needing work or payment,
   * optionally excluding one row — the review path uses it to keep a
   * multi-milestone agreement ACTIVE until its last milestone is
   * accepted (arc-audit H6). `null` when NO plan exists — an
   * unverifiable state the caller must not read as "0 remaining"
   * (R4-M6: 0 would complete the agreement unpaid).
   */
  pendingMilestoneCount(
    agreementId: string,
    excludingMilestoneRowId?: string,
  ): Promise<number | null>;
}

/** Best-effort wrapper — settlement errors log, never throw up. A
 *  CONFLICT means a forged or stale plan won the agreementRef race —
 *  that's loud (error), not routine warn. */
function settled(
  what: string,
  res: { ok: boolean; error?: { code: string; message: string } },
): void {
  if (res.ok) return;
  const fields = { code: res.error?.code, message: res.error?.message };
  if (res.error?.code === "CONFLICT") {
    logger.error(`settlement bridge: ${what} CONFLICT — forged or stale plan terms`, fields);
  } else {
    logger.warn(`settlement bridge: ${what} failed`, fields);
  }
}

export function createCommerceSettlementBridge(
  getDb: () => Database,
): CommerceSettlementBridge {
  const sctx = () => createSettlementCtx(getDb());
  // Local closure — M-E: method calls via `this.ensurePlan` break the
  // moment the bridge is destructured, spread or proxied.
  const ensurePlan: CommerceSettlementBridge["ensurePlan"] = async (input) => {
    const milestones: MilestoneInput[] = input.milestones?.length
      ? input.milestones
      : [
          {
            milestoneId: "full",
            title: "Full delivery",
            amountUsd: input.agreedAmount,
          },
        ];
    settled(
      "ensurePlan",
      await createPlan(
        sctx(),
        {
          agreementRef: input.agreementId,
          buyerWallet: input.buyerWallet,
          providerWallet: input.providerWallet,
          currency: input.currency ?? "USDC",
          totalUsd: input.agreedAmount,
          milestones,
        },
        input.buyerWallet,
      ),
    );
  };
  // H7: the documented "lazy retry" — a plan missing on a live
  // agreement means the accept-time ensurePlan failed; heal it from
  // the offer's declared milestone vector (R2-H5: a bare "full" plan
  // would mis-shape a multi-milestone agreement). M-D: only for
  // ACTIVE agreements — a write on a read path needs live state.
  const healedPlan = async (agreementId: string) => {
    const existing = await getPlanByAgreement(sctx(), agreementId);
    if (existing) return existing;
    const a = await getDb().commerce.agreements.getById(agreementId);
    if (!a || a.status !== "ACTIVE") return null;
    // M-5: the canonical vector was snapshotted into the agreement at
    // accept — the offer row may have moved since.
    const snap =
      a.payload && typeof a.payload === "object"
        ? (a.payload as Record<string, unknown>)["milestones"]
        : undefined;
    await ensurePlan({
      agreementId,
      buyerWallet: a.buyerWallet,
      providerWallet: a.providerWallet,
      agreedAmount: a.agreedAmount,
      milestones: Array.isArray(snap) ? (snap as MilestoneInput[]) : null,
    });
    return getPlanByAgreement(sctx(), agreementId);
  };
  return {
    ensurePlan,

    async findMilestone(agreementId, milestoneRef) {
      const plan = await healedPlan(agreementId);
      if (!plan) return null;
      const m = await getDb().settlement.milestones.getByPlanMilestone(
        plan.id,
        milestoneRef,
      );
      return m ? { id: m.id, status: m.status } : null;
    },

    async openMilestones(agreementId) {
      const plan = await healedPlan(agreementId);
      if (!plan) return [];
      const ms = await getDb().settlement.milestones.listByPlan(plan.id);
      return ms
        .filter((m) => ["PENDING", "READY"].includes(m.status))
        .map((m) => ({ rowId: m.id, ref: m.milestoneId, status: m.status }));
    },

    // H7: the documented "lazy retry" — every milestone path re-runs
    // ensurePlan first so a bridge failure at accept time heals itself.
    // (ensurePlan is idempotent on agreementRef; a forged-terms plan
    // now CONFLICTs loudly instead of being adopted — C1.)
    async pendingMilestoneCount(agreementId, excludingMilestoneRowId) {
      const plan = await getPlanByAgreement(sctx(), agreementId);
      // R4-M6: no plan = "cannot prove payable state", NOT "nothing
      // pending". Returning 0 completes the agreement unpaid.
      if (!plan) return null;
      const ms = await getDb().settlement.milestones.listByPlan(plan.id);
      // R2-H4: count only work not yet ACCEPTED. APPROVED is awaiting
      // the (intentionally lagging, D-227-4) manual payout — counting
      // it deadlocks agreement+task completion forever.
      return ms.filter(
        (m) =>
          m.id !== excludingMilestoneRowId &&
          !["RELEASED", "CANCELLED", "APPROVED"].includes(m.status),
      ).length;
    },

    async submitMilestone(milestoneRowId, actorWallet, submissionRef) {
      settled(
        "submitMilestone",
        await submitForReview(
          sctx(),
          { milestoneRowId, submissionRef },
          actorWallet,
        ),
      );
    },

    async approveMilestone(milestoneRowId, actorWallet) {
      const res = await approveMilestone(sctx(), milestoneRowId, actorWallet);
      settled("approveMilestone", res);
      return res;
    },

    async revertApproval(milestoneRowId, actorWallet, opts) {
      settled(
        "revertApproval",
        await revertApproval(sctx(), milestoneRowId, actorWallet, opts),
      );
    },

    async releaseMilestone(milestoneRowId, actorWallet) {
      settled(
        "releaseMilestone",
        await reopenMilestone(sctx(), milestoneRowId, actorWallet),
      );
    },
  };
}
