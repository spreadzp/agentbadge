/**
 * SLICE-227-8 — the review's post-commit settlement sync, extracted
 * under the 300-line cap. Every path is best-effort: a failure logs
 * and never rolls back the committed verdict (the commerce atomic is
 * the state of record; settlement rows follow through CAS-only ops
 * that are safe to retry). Dangerous leftovers carry a stable `repair`
 * error-log key so operators can act on them (R8-M2).
 *
 *  - REJECT/REVISION_REQUIRED: release the bound milestone
 *    (READY→PENDING, R4-M5); APPROVED too, but ONLY an `appr_` epoch
 *    still bound to this submission — resolver (`rsv_`) and operator
 *    (`ops_`) rulings are never un-done by a verdict (R8-M1).
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
import { logRevertOutcome } from "./review-revert";

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
      } else if (bound && bound.status === "APPROVED") {
        // R7-M2 + R8-M1: a skipped/aborted revert can leave APPROVED +
        // OPEN intent under a submission whose verdict then commits
        // REJECT — the READY-only release strands a payable intent.
        // But the release may undo ONLY a commerce-minted (`appr_`)
        // epoch still bound to THIS submission: a resolver-restored
        // (`rsv_`) or operator-forced (`ops_`) approval is a ruling,
        // and a stale binding is not ours to unbind.
        const releasable =
          bound.submissionRef === result.submission.id &&
          bound.escrowRef?.startsWith("appr_") === true;
        if (!releasable) {
          logger.error(
            "APPROVED milestone on rejected submission left standing — non-commerce epoch or foreign binding",
            {
              repair: "review milestone release",
              milestoneRowId: bound.id,
              submissionId: result.submission.id,
              boundSubmissionRef: bound.submissionRef ?? null,
              // R9-M1: the operator exit — audited APPROVED→PENDING.
              exit: "POST /admin/settlement/milestones/:id/release",
            },
          );
        } else {
          // release:true goes APPROVED→PENDING and cancels the OPEN
          // intent in the same atomic. The epoch we just checked is
          // pinned inside the revert's atomic — a resolver re-stamp
          // landing between our read and the CAS is refused, not
          // erased. R8-M2/R9-M2c: same classifier as the gate revert —
          // a benign no-op (sibling already released / epoch moved on)
          // warns, only dangerous leftovers carry `repair`.
          const res = await ctx.settlement!.revertApproval(bound.id, actor, {
            release: true,
            approvalToken: bound.escrowRef ?? undefined,
            // R11 nit 7: the verdict COMMITTED (as reject) — the
            // default "verdict_not_committed" reason would be wrong.
            eventReason: "verdict_rejected",
          });
          logRevertOutcome("reject-release", res, {
            milestoneRowId: bound.id,
            submissionId: result.submission.id,
          });
        }
      } else if (bound) {
        // R9 nit 9: a bound milestone in any other terminal/held state
        // under a rejected submission — nothing to do, but a line for
        // forensics costs nothing.
        logger.info("bound milestone left as-is on rejected submission", {
          milestoneRowId: bound.id,
          milestoneStatus: bound.status,
          submissionId: result.submission.id,
        });
      }
    } catch (err) {
      logger.error("settlement milestone release failed", {
        repair: "review milestone release",
        milestoneRef: result.submission.milestoneRef,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    // R9-M1: the completion pass runs on EVERY verdict — when the
    // rejected submission's milestone is RELEASED (operator paid a
    // ruling), CANCELLED (FOR_BUYER), or standing APPROVED under a
    // non-commerce epoch, no payable work remains and the agreement
    // must not deadlock ACTIVE forever.
    await completionPass(ctx, result);
    return;
  }
  if (result.submission.milestoneRef && settleMilestoneId !== undefined) {
    try {
      const now = await ctx.settlement!.findMilestone(
        result.agreement.id,
        result.submission.milestoneRef,
      );
      // Only a READY milestone is resumable — APPROVED already
      // landed, DISPUTED belongs to the dispute path. R8-M2: a failed
      // resync leaves ACCEPTED + READY + a possibly-cancelled intent —
      // that needs an operator-visible `repair` signal, not a warn.
      if (now && now.status === "READY") {
        const ap = await ctx.settlement!.approveMilestone(now.id, actor);
        if (!ap?.ok) {
          logger.error(
            "settlement repair needed — ACCEPTED verdict resync approve failed",
            {
              repair: "re-approve milestone",
              milestoneRowId: now.id,
              submissionId: result.submission.id,
              code: ap?.error?.code,
              message: ap?.error?.message,
            },
          );
        }
      }
    } catch (err) {
      logger.error("settlement approveMilestone resync failed", {
        repair: "re-approve milestone",
        milestoneRef: result.submission.milestoneRef,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  await completionPass(ctx, result);
}

/**
 * M-1/R9-M1: a concurrent sibling review may have finished the last
 * milestone after the pre-commit count; a REJECTED verdict whose bound
 * milestone is RELEASED/CANCELLED or standing under a non-commerce
 * epoch has no payable work left either. Re-check and complete the
 * agreement (+ task) if it now reads zero. R4-M6: null = no plan →
 * cannot prove settled → never complete on an unverifiable state.
 */
async function completionPass(
  ctx: CommerceCtx,
  result: { agreement: CommerceAgreementRow },
): Promise<void> {
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
