/**
 * Submission review — buyer verdicts (D-224-5). Split from
 * submission-service.ts under the 300-line cap.
 *
 * ACCEPTED → agreement COMPLETED; the task completes only once EVERY
 * agreement is terminal (D-227 relaxes D-224-9 for multi-provider),
 * otherwise it returns to IN_PROGRESS. REJECTED / REVISION_REQUIRED →
 * IN_PROGRESS resubmission round (agreement stays ACTIVE).
 *
 * Post-commit, best-effort: milestone-bound submissions drive the
 * settlement milestone to APPROVED (payout intent auto-created), then
 * the 234-17 fact hooks fire. A bridge/hook failure never rolls back
 * the committed verdict.
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
  let settleMilestoneId: string | undefined;
  let pendingAfter = 0;
  if (verdict === "ACCEPTED" && ctx.settlement) {
    const pre = await stores.submissions.getById(submissionId);
    if (pre?.milestoneRef) {
      const found = await ctx.settlement.findMilestone(
        pre.agreementId,
        pre.milestoneRef,
      );
      if (found) {
        settleMilestoneId = found.id;
        pendingAfter = await ctx.settlement.pendingMilestoneCount(
          pre.agreementId,
          found.id,
        );
      }
    }
  }
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

  // SLICE-227-5: post-commit — buyer acceptance approves the bound
  // settlement milestone (→ APPROVED + payout intent). Best-effort:
  // bridge failures log; the commerce verdict already committed.
  if (
    verdict === "ACCEPTED" &&
    result.submission.milestoneRef &&
    ctx.settlement
  ) {
    try {
      // H6: reuse the pre-commit lookup — a re-read could race a
      // dispute; H7's lazy ensurePlan already healed inside find.
      const found =
        settleMilestoneId !== undefined
          ? { id: settleMilestoneId }
          : await ctx.settlement.findMilestone(
              result.agreement.id,
              result.submission.milestoneRef,
            );
      if (found) {
        await ctx.settlement.approveMilestone(found.id, actor);
      }
    } catch (err) {
      logger.warn("settlement approveMilestone failed", {
        milestoneRef: result.submission.milestoneRef,
        error: err instanceof Error ? err.message : String(err),
      });
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
