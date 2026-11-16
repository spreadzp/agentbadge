/**
 * Submission service — provider submits work on an ACTIVE agreement;
 * buyer reviews (D-224-5). ACCEPTED completes task + agreement;
 * REJECTED / REVISION_REQUIRED sends the task back to IN_PROGRESS for a
 * resubmission round (agreement stays ACTIVE).
 */
import type {
  CommerceAgreementRow,
  CommerceSubmissionRow,
  CommerceTaskRow,
} from "@agentbadge/database";
import { logger } from "@agentbadge/passport/logger";
import { idempotentWrite } from "../../contract-guards";
import {
  assertEvidenceRefs,
  assertIdempotencyKey,
  assertSummary,
  assertWallet,
  newId,
} from "../guards";
import {
  SUBMISSION_VERDICTS,
  forbidden,
  guardRejected,
  type SubmissionCreateInput,
  type SubmissionVerdict,
} from "../types";
import { mustGet, transitionRow, type CommerceCtx } from "./ctx";

export interface SubmissionService {
  submit(
    actorWallet: string,
    agreementId: string,
    input: SubmissionCreateInput,
    idempotencyKey?: string,
    /** H1: sha256 of the signed request body — binds the dedupe entry. */
    bodyFingerprint?: string,
  ): Promise<{ submission: CommerceSubmissionRow; duplicate: boolean }>;
  review(
    actorWallet: string,
    submissionId: string,
    verdict: SubmissionVerdict,
    reviewNote?: string,
  ): Promise<{
    submission: CommerceSubmissionRow;
    task: CommerceTaskRow;
    agreement: CommerceAgreementRow;
  }>;
  listByAgreement(agreementId: string): Promise<CommerceSubmissionRow[]>;
}

export function createSubmissionService(ctx: CommerceCtx): SubmissionService {
  const { stores, emit } = ctx;

  return {
    async submit(
      actorWallet,
      agreementId,
      input,
      idempotencyKey,
      bodyFingerprint,
    ) {
      const provider = assertWallet(actorWallet, "actorWallet");
      if (idempotencyKey !== undefined) {
        assertIdempotencyKey(idempotencyKey);
        const res = await idempotentWrite(
          "commerce.submission.submit",
          idempotencyKey,
          async () => {
            const submission = await doSubmit(provider);
            return { status: 201, body: { submission } };
          },
          {
            owner: provider,
            resource: agreementId,
            fingerprint: bodyFingerprint,
          },
        );
        return {
          submission: (res.body as { submission: CommerceSubmissionRow })
            .submission,
          duplicate: res.duplicate,
        };
      }
      const submission = await doSubmit(provider);
      return { submission, duplicate: false };

      async function doSubmit(
        provider: string,
      ): Promise<CommerceSubmissionRow> {
        // C2: every graph write inside one atomic section — a failed
        // precondition or transition rolls back the whole submit.
        return stores.atomic(async (tx) => {
          const txCtx = { ...ctx, stores: tx };
          const agreement = mustGet(
            await tx.agreements.getById(agreementId),
            "agreement",
            agreementId,
          );
          if (agreement.providerWallet !== provider) {
            throw forbidden("only the agreement provider can submit work");
          }
          if (agreement.status !== "ACTIVE") {
            throw guardRejected(
              `agreement is ${agreement.status} — submissions closed`,
              { agreementId, status: agreement.status },
            );
          }
          const task = mustGet(
            await tx.tasks.getById(agreement.taskId),
            "task",
            agreement.taskId,
          );
          // Precondition before any write: task must be work-in-flight.
          // (UNDER_REVIEW means a previous submission is already pending
          // review — a second submit is a conflict, not a silent skip.)
          if (task.status !== "IN_PROGRESS") {
            throw guardRejected(
              `task is ${task.status} — submissions require IN_PROGRESS`,
              { taskId: task.id, status: task.status },
            );
          }
          const summary = assertSummary(input.summary, "summary");
          const evidenceRefs = assertEvidenceRefs(input.evidenceRefs);
          const submission = await tx.submissions.create({
            id: newId("sub"),
            agreementId: agreement.id,
            providerWallet: provider,
            summary,
            resultUrl: input.resultUrl ?? null,
            status: "SUBMITTED",
            submittedAtMs: Date.now(),
            payload: {
              evidenceRefs,
              ...(input.payload && typeof input.payload === "object"
                ? (input.payload as Record<string, unknown>)
                : {}),
            },
          });
          if (!submission) throw new Error("submission id collision");
          await emit.emit({
            entityType: "submission",
            entityId: submission.id,
            eventType: "submission.submitted",
            actorWallet: provider,
            payload: { agreementId: agreement.id },
          });
          // task: IN_PROGRESS → SUBMITTED → UNDER_REVIEW (awaiting buyer)
          const submitted = await transitionRow(
            txCtx,
            "task",
            task,
            "SUBMITTED",
            (from) => tx.tasks.applyStatus(task.id, from, "SUBMITTED"),
          );
          await transitionRow(txCtx, "task", submitted, "UNDER_REVIEW", (from) =>
            tx.tasks.applyStatus(task.id, from, "UNDER_REVIEW"),
          );
          return submission;
        });
      }
    },

    async review(actorWallet, submissionId, verdict, reviewNote) {
      const actor = assertWallet(actorWallet, "actorWallet");
      if (!SUBMISSION_VERDICTS.includes(verdict)) {
        throw guardRejected(`verdict must be ${SUBMISSION_VERDICTS.join("|")}`);
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
        if (verdict === "ACCEPTED") {
          // normalize SUBMITTED → UNDER_REVIEW first when review raced
          // straight past the marker transition
          const underReview =
            task.status === "SUBMITTED"
              ? await transitionRow(txCtx, "task", task, "UNDER_REVIEW", (from) =>
                tx.tasks.applyStatus(task.id, from, "UNDER_REVIEW"),
              )
              : task;
          taskRow = await transitionRow(
            txCtx,
            "task",
            underReview,
            "COMPLETED",
            (from) => tx.tasks.applyStatus(task.id, from, "COMPLETED"),
          );
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
        } else {
          // REJECTED / REVISION_REQUIRED → resubmission round (D-224-9)
          const underReview =
            task.status === "SUBMITTED"
              ? await transitionRow(txCtx, "task", task, "UNDER_REVIEW", (from) =>
                tx.tasks.applyStatus(task.id, from, "UNDER_REVIEW"),
              )
              : task;
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
    },

    listByAgreement: (agreementId) =>
      stores.submissions.listByAgreement(agreementId),
  };
}
