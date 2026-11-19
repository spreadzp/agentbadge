/**
 * SLICE-227-8 — the review's post-commit settlement sync, extracted
 * under the 300-line cap. Every path is best-effort: a failure logs a
 * warn and never rolls back the committed verdict (the commerce atomic
 * is the state of record; settlement rows follow through CAS-only ops
 * that are safe to retry).
 *
 *  - REJECT/REVISION_REQUIRED: release the bound milestone
 *    (READY→PENDING, R4-M5) so the resubmission round can rebind it.
 *  - ACCEPTED: resync the pre-commit approve for the narrow
 *    pre-read-race window, then the M-1 completion pass finishes
 *    agreements stranded ACTIVE by concurrent sibling reviews.
 */
import type {
  CommerceAgreementRow,
  CommerceSubmissionRow,
  CommerceTaskRow,
} from "@agentbadge/database";
import { logger } from "@agentbadge/passport/logger";
import type { SubmissionVerdict } from "../types";
import { transitionRow, type CommerceCtx } from "./ctx";

export async function postCommitSettlementSync(
  ctx: CommerceCtx,
  actor: string,
  verdict: SubmissionVerdict,
  result: {
    submission: CommerceSubmissionRow;
    task: CommerceTaskRow;
    agreement: CommerceAgreementRow;
  },
  settleMilestoneId?: string,
): Promise<void> {
  if (verdict !== "ACCEPTED") {
    if (!result.submission.milestoneRef) return;
    try {
      const bound = await ctx.settlement!.findMilestone(
        result.agreement.id,
        result.submission.milestoneRef,
      );
      if (bound && bound.status === "READY") {
        // R6 nit 9: compare-and-release — only unbind when the
        // milestone still points at THIS rejected submission; a
        // newer submission's READY binding must survive.
        await ctx.settlement!.releaseMilestone(bound.id, actor, {
          expectedSubmissionRef: result.submission.id,
        });
      }
    } catch (err) {
      logger.warn("settlement milestone release failed", {
        milestoneRef: result.submission.milestoneRef,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return;
  }
  if (result.submission.milestoneRef && settleMilestoneId !== undefined) {
    try {
      const now = await ctx.settlement!.findMilestone(
        result.agreement.id,
        result.submission.milestoneRef,
      );
      // Only a READY milestone is resumable — APPROVED already
      // landed, DISPUTED belongs to the dispute path.
      if (now && now.status === "READY") {
        await ctx.settlement!.approveMilestone(now.id, actor);
      }
    } catch (err) {
      logger.warn("settlement approveMilestone resync failed", {
        milestoneRef: result.submission.milestoneRef,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  // M-1: a concurrent sibling review may have finished the last
  // milestone after the pre-commit count. Re-check and complete the
  // agreement (+ task) if it now reads zero. R4-M6: null = no plan →
  // cannot prove settled → never complete on an unverifiable state.
  if (result.agreement.status !== "ACTIVE") return;
  try {
    const pending = await ctx.settlement!.pendingMilestoneCount(
      result.agreement.id,
    );
    if (pending === 0) {
      await completeAgreementIfClear(ctx, result.agreement.id);
    }
  } catch (err) {
    logger.warn("settlement completion pass failed", {
      agreementId: result.agreement.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * M-1 completion pass — runs AFTER the review commit when the agreement
 * is still ACTIVE but the settlement plan now reads zero not-yet-
 * accepted milestones (a concurrent sibling review, or an earlier
 * swallowed state, can strand it). Completes the agreement, and the
 * task when it was the last live agreement.
 */
export async function completeAgreementIfClear(
  ctx: CommerceCtx,
  agreementId: string,
): Promise<void> {
  const { stores } = ctx;
  await stores.atomic(async (tx) => {
    const txCtx = { ...ctx, stores: tx };
    const agreement = await tx.agreements.getById(agreementId);
    if (!agreement || agreement.status !== "ACTIVE") return;
    const done = await transitionRow(
      txCtx,
      "agreement",
      agreement,
      "COMPLETED",
      (from) =>
        tx.agreements.applyStatus(agreement.id, from, "COMPLETED", {
          completedAtMs: Date.now(),
        }),
    );
    if (!done) return;
    const task = await tx.tasks.getById(agreement.taskId);
    if (!task) return;
    const remaining = await tx.agreements.countByTaskId(task.id, {
      excludeStatuses: ["CANCELLED", "COMPLETED"],
    });
    if (remaining === 0) {
      await transitionRow(txCtx, "task", task, "COMPLETED", (from) =>
        tx.tasks.applyStatus(task.id, from, "COMPLETED"),
      );
    }
  });
}
