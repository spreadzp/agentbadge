/**
 * Submission review — buyer verdicts (D-224-5). Split from
 * submission-service.ts under the 300-line cap.
 *
 * ACCEPTED → agreement COMPLETED; the task completes only once EVERY
 * agreement is terminal (D-227 relaxes D-224-9 for multi-provider),
 * otherwise it returns to IN_PROGRESS. REJECTED / REVISION_REQUIRED →
 * IN_PROGRESS resubmission round (agreement stays ACTIVE).
 *
 * Settlement ordering (R3-H3): a milestone-bound ACCEPTED review
 * approves the settlement milestone BEFORE the verdict commits — an
 * approve failure keeps the submission SUBMITTED and retryable
 * instead of a swallowed post-commit miss. APPROVED on pre-read is a
 * valid resume state (a prior review's approve landed, its verdict
 * commit did not). Post-commit, a resync re-checks the narrow race
 * window and the M-1 completion pass finishes agreements stranded by
 * concurrent sibling reviews; then the 234-17 fact hooks fire.
 */
import type {
  CommerceAgreementRow,
  CommerceSubmissionRow,
  CommerceTaskRow,
} from "@agentbadge/database";
import { logger } from "@agentbadge/passport/logger";
import { assertSummary, assertWallet } from "../guards";
import {
  SUBMISSION_VERDICTS,
  forbidden,
  guardRejected,
  type SubmissionVerdict,
} from "../types";
import { mustGet, transitionRow, type CommerceCtx } from "./ctx";
import { resolveSettlementGate } from "./review-settlement";

export async function reviewSubmission(
  ctx: CommerceCtx,
  actorWallet: string,
  submissionId: string,
  verdict: SubmissionVerdict,
  reviewNote?: string,
): Promise<{
  submission: CommerceSubmissionRow;
  task: CommerceTaskRow;
  agreement: CommerceAgreementRow;
}> {
  const { stores } = ctx;
  const actor = assertWallet(actorWallet, "actorWallet");
  if (!SUBMISSION_VERDICTS.includes(verdict)) {
    throw guardRejected(`verdict must be ${SUBMISSION_VERDICTS.join("|")}`);
  }
  // H6: pre-read (read-only, outside the tx) — does the settlement
  // plan still have payable work after this milestone? The agreement
  // must outlive its first accepted submission on multi-milestone
  // plans, else milestones 2..N can never be approved or paid.
  // R3-H3: the settlement gate runs BEFORE the verdict commits —
  // resolveSettlementGate approves the bound milestone and counts
  // not-yet-accepted work (extracted to review-settlement.ts).
  const gate =
    verdict === "ACCEPTED" && ctx.settlement
      ? await resolveSettlementGate(ctx, actor, submissionId)
      : { pendingAfter: 0 };
  const settleMilestoneId = gate.milestoneRowId;
  const pendingAfter = gate.pendingAfter;
  // C2: preconditions + all graph transitions inside one atomic
  // section — the verdict can never persist without its task/
  // agreement graph updates.
  const result = await stores.atomic(async (tx) => {
    const txCtx = { ...ctx, stores: tx };
    const submission = mustGet(
      await tx.submissions.getById(submissionId),
      "submission",
      submissionId,
    );
    const agreement = mustGet(
      await tx.agreements.getById(submission.agreementId),
      "agreement",
      submission.agreementId,
    );
    const task = mustGet(
      await tx.tasks.getById(agreement.taskId),
      "task",
      agreement.taskId,
    );
    if (task.buyerWallet !== actor) {
      throw forbidden("only the buyer can review a submission");
    }
    if (reviewNote !== undefined) {
      assertSummary(reviewNote, "reviewNote");
    }
    // Preconditions before any write: the submission is pending and
    // the task is actually under review.
    if (submission.status !== "SUBMITTED") {
      throw guardRejected(
        `submission is ${submission.status} — already reviewed`,
        { submissionId, status: submission.status },
      );
    }
    if (task.status !== "UNDER_REVIEW" && task.status !== "SUBMITTED") {
      throw guardRejected(
        `task is ${task.status} — no review pending`,
        { taskId: task.id, status: task.status },
      );
    }
    if (agreement.status !== "ACTIVE") {
      throw guardRejected(
        `agreement is ${agreement.status} — review closed`,
        { agreementId: agreement.id, status: agreement.status },
      );
    }
    const reviewed = await transitionRow(
      txCtx,
      "submission",
      submission,
      verdict,
      (from) =>
        tx.submissions.applyStatus(submission.id, from, verdict, {
          reviewNote: reviewNote ?? undefined,
          reviewedAtMs: Date.now(),
        }),
      { actorWallet: actor },
    );

    let taskRow: CommerceTaskRow = task;
    let agreementRow: CommerceAgreementRow = agreement;
    // normalize SUBMITTED → UNDER_REVIEW first when review raced
    // straight past the marker transition
    const underReview =
      task.status === "SUBMITTED"
        ? await transitionRow(txCtx, "task", task, "UNDER_REVIEW", (from) =>
            tx.tasks.applyStatus(task.id, from, "UNDER_REVIEW"),
          )
        : task;
    if (verdict === "ACCEPTED") {
      // H6: complete only when the plan has no remaining payable
      // work — earlier milestones of a multi-milestone agreement
      // keep it ACTIVE until their own acceptance.
      if (pendingAfter === 0) {
        agreementRow = await transitionRow(
          txCtx,
          "agreement",
          agreement,
          "COMPLETED",
          (from) =>
            tx.agreements.applyStatus(agreement.id, from, "COMPLETED", {
              completedAtMs: Date.now(),
            }),
        );
      }
      // D-227: the task completes only when every agreement has
      // settled — a live ACTIVE/DISPUTED agreement sends the task
      // back to IN_PROGRESS (multi-provider relaxes D-224-9).
      const remaining = await tx.agreements.countByTaskId(task.id, {
        excludeStatuses: ["CANCELLED", "COMPLETED"],
      });
      const to = remaining === 0 ? "COMPLETED" : "IN_PROGRESS";
      taskRow = await transitionRow(txCtx, "task", underReview, to, (from) =>
        tx.tasks.applyStatus(task.id, from, to),
      );
    } else {
      // REJECTED / REVISION_REQUIRED → resubmission round (D-224-9)
      taskRow = await transitionRow(
        txCtx,
        "task",
        underReview,
        "IN_PROGRESS",
        (from) => tx.tasks.applyStatus(task.id, from, "IN_PROGRESS"),
      );
    }
    return { submission: reviewed, task: taskRow, agreement: agreementRow };
  });

  // SLICE-227-5: post-commit — the bound milestone was approved
  // PRE-commit (R3-H3), so this is only a resync for the narrow
  // pre-read-race window + the M-1 completion pass for agreements
  // still ACTIVE (concurrent reviews on sibling milestones).
  if (verdict === "ACCEPTED" && ctx.settlement) {
    if (result.submission.milestoneRef && settleMilestoneId !== undefined) {
      try {
        const now = await ctx.settlement.findMilestone(
          result.agreement.id,
          result.submission.milestoneRef,
        );
        if (now && now.status !== "APPROVED" && now.status !== "RELEASED") {
          await ctx.settlement.approveMilestone(now.id, actor);
        }
      } catch (err) {
        logger.warn("settlement approveMilestone resync failed", {
          milestoneRef: result.submission.milestoneRef,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    // M-1: pendingAfter was pre-commit — a concurrent sibling review
    // may have finished the last milestone in between. Re-check and
    // complete the agreement (+ task) if it now reads zero.
    if (result.agreement.status === "ACTIVE") {
      try {
        const pending = await ctx.settlement.pendingMilestoneCount(
          result.agreement.id,
        );
        if (pending === 0) {
          await completeAgreementIfClear(
            ctx,
            result.agreement.id,
          );
        }
      } catch (err) {
        logger.warn("settlement completion pass failed", {
          agreementId: result.agreement.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }
  // SLICE-234-17: post-commit fact emission (best-effort — a hook
  // failure logs a warn and never rolls back the transition).
  if (verdict === "ACCEPTED" && ctx.hooks?.onSubmissionAccepted) {
    try {
      await ctx.hooks.onSubmissionAccepted({
        submissionId: result.submission.id,
        agreementId: result.agreement.id,
        taskId: result.task.id,
        providerWallet: result.agreement.providerWallet,
      });
    } catch (err) {
      logger.warn("onSubmissionAccepted hook failed (facts skipped)", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return result;
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
