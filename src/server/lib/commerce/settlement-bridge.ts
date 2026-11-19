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
  /** Provider submits the milestone for review (post-commit). */
  submitMilestone(
    milestoneRowId: string,
    actorWallet: string,
    submissionRef?: string,
  ): Promise<void>;
  /** Buyer approve → APPROVED + payout intent (post-commit). */
  approveMilestone(milestoneRowId: string, actorWallet: string): Promise<void>;
}

/** Best-effort wrapper — settlement errors log, never throw up. */
function settled(
  what: string,
  res: { ok: boolean; error?: { code: string; message: string } },
): void {
  if (!res.ok) {
    logger.warn(`settlement bridge: ${what} failed`, {
      code: res.error?.code,
      message: res.error?.message,
    });
  }
}

export function createCommerceSettlementBridge(
  getDb: () => Database,
): CommerceSettlementBridge {
  const sctx = () => createSettlementCtx(getDb());
  return {
    async ensurePlan(input) {
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
    },

    async findMilestone(agreementId, milestoneRef) {
      const plan = await getPlanByAgreement(sctx(), agreementId);
      if (!plan) return null;
      const m = await getDb().settlement.milestones.getByPlanMilestone(
        plan.id,
        milestoneRef,
      );
      return m ? { id: m.id, status: m.status } : null;
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
      settled(
        "approveMilestone",
        await approveMilestone(sctx(), milestoneRowId, actorWallet),
      );
    },
  };
}
