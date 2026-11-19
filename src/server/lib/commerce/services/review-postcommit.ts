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
import type { SettlementGate } from "./review-settlement";

/**
 * R4-H1 + R5-H2 + R6-M2 + R7-M4 — undo THIS gate's own pre-commit
 * approve when the verdict atomic failed. Only our approve reverts —
 * a sibling review's APPROVED belongs to its committed verdict.
 * Re-reads the submission first: ACCEPTED → skip (approval belongs to
 * that verdict); REJECTED/REVISION_REQUIRED → release straight to
 * PENDING; SUBMITTED → revert to READY. A FAILED re-read is UNKNOWN,
 * not "not committed" — fail closed and skip (a lost-ack verdict
 * looks identical). After a landed revert, one more re-read heals
 * the sibling-committed-in-the-gap case. `repair` is a stable
 * error-log key — every refused/aborted/ambiguous path is
 * operator-visible.
 */
export async function revertGateApproval(
  ctx: CommerceCtx,
  actor: string,
  submissionId: string,
  gate: SettlementGate,
): Promise<void> {
  const { stores } = ctx;
  if (
    gate.approvedByUs !== true ||
    !ctx.settlement ||
    gate.milestoneRowId === undefined
  ) {
    return;
  }
  const settleMilestoneId = gate.milestoneRowId;
  try {
    const sub = await stores.submissions
      .getById(submissionId)
      .catch(() => null);
    if (!sub) {
      logger.error("approval revert skipped — submission re-read failed", {
        repair: "review milestone approval",
        milestoneRowId: settleMilestoneId,
        submissionId,
      });
    } else if (sub.status === "ACCEPTED") {
      // Sibling ACCEPT committed — approval belongs to that verdict.
    } else if (
      sub.status === "SUBMITTED" ||
      sub.status === "REJECTED" ||
      sub.status === "REVISION_REQUIRED"
    ) {
      const res = await ctx.settlement.revertApproval(
        settleMilestoneId,
        actor,
        {
          intentId: gate.intentId,
          approvalToken: gate.approvalToken,
          release:
            sub.status === "REJECTED" ||
            sub.status === "REVISION_REQUIRED",
        },
      );
      if (res && !res.reverted) {
        logger.error("approval revert refused — approval stands", {
          repair: "review milestone approval",
          milestoneRowId: settleMilestoneId,
          submissionId,
          intentId: gate.intentId,
        });
      }
      if (res?.reverted) {
        const after = await stores.submissions
          .getById(submissionId)
          .catch(() => null);
        if (after?.status === "ACCEPTED") {
          const heal = await ctx.settlement
            .approveMilestone(settleMilestoneId, actor)
            .catch(() => null);
          if (heal?.ok) {
            logger.warn(
              "verdict committed during revert — approval healed",
              { milestoneRowId: settleMilestoneId, submissionId },
            );
          } else {
            logger.error(
              "settlement repair needed — ACCEPTED verdict has no payable intent",
              {
                repair: "re-approve milestone",
                milestoneRowId: settleMilestoneId,
                submissionId,
                code: heal?.error?.code,
                message: heal?.error?.message,
              },
            );
          }
        }
      }
    } else {
      logger.error("approval revert skipped — unexpected status", {
        repair: "review milestone approval",
        milestoneRowId: settleMilestoneId,
        submissionId,
        status: sub.status,
      });
    }
  } catch (revertErr) {
    logger.error("settlement approval revert failed", {
      repair: "review milestone approval",
      milestoneRowId: settleMilestoneId,
      error:
        revertErr instanceof Error ? revertErr.message : String(revertErr),
    });
  }
}

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
        // R7-M2: a skipped/aborted revert can leave APPROVED + OPEN
        // intent under a submission whose verdict then commits REJECT
        // — the READY-only release would strand a payable intent.
        // release:true goes APPROVED→PENDING and cancels the OPEN
        // intent in the same atomic.
        await ctx.settlement!.revertApproval(bound.id, actor, {
          release: true,
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
