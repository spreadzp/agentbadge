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
    async submit(actorWallet, agreementId, input, idempotencyKey) {
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
        const agreement = mustGet(
          await stores.agreements.getById(agreementId),
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
        const summary = assertSummary(input.summary, "summary");
        const evidenceRefs = assertEvidenceRefs(input.evidenceRefs);
        const submission = await stores.submissions.create({
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
        const task = mustGet(
          await stores.tasks.getById(agreement.taskId),
          "task",
          agreement.taskId,
        );
        if (task.status === "IN_PROGRESS") {
          await transitionRow(ctx, "task", task, "SUBMITTED", (from) =>
            stores.tasks.applyStatus(task.id, from, "SUBMITTED"),
          );
        }
        const current = mustGet(
          await stores.tasks.getById(task.id),
          "task",
          task.id,
        );
        await transitionRow(ctx, "task", current, "UNDER_REVIEW", (from) =>
          stores.tasks.applyStatus(task.id, from, "UNDER_REVIEW"),
        );
        return submission;
      }
    },

    async review(actorWallet, submissionId, verdict, reviewNote) {
      const actor = assertWallet(actorWallet, "actorWallet");
      if (!SUBMISSION_VERDICTS.includes(verdict)) {
        throw guardRejected(`verdict must be ${SUBMISSION_VERDICTS.join("|")}`);
      }
      const submission = mustGet(
        await stores.submissions.getById(submissionId),
        "submission",
        submissionId,
      );
      const agreement = mustGet(
        await stores.agreements.getById(submission.agreementId),
        "agreement",
        submission.agreementId,
      );
      const task = mustGet(
        await stores.tasks.getById(agreement.taskId),
        "task",
        agreement.taskId,
      );
      if (task.buyerWallet !== actor) {
        throw forbidden("only the buyer can review a submission");
      }
      if (reviewNote !== undefined) {
        assertSummary(reviewNote, "reviewNote");
      }
      const reviewed = await transitionRow(
        ctx,
        "submission",
        submission,
        verdict,
        (from) =>
          stores.submissions.applyStatus(submission.id, from, verdict, {
            reviewNote: reviewNote ?? undefined,
            reviewedAtMs: Date.now(),
          }),
        { actorWallet: actor },
      );

      let taskRow: CommerceTaskRow = task;
      let agreementRow: CommerceAgreementRow = agreement;
      if (verdict === "ACCEPTED") {
        taskRow = await transitionRow(ctx, "task", task, "COMPLETED", (from) =>
          stores.tasks.applyStatus(task.id, from, "COMPLETED"),
        );
        agreementRow = await transitionRow(
          ctx,
          "agreement",
          agreement,
          "COMPLETED",
          (from) =>
            stores.agreements.applyStatus(agreement.id, from, "COMPLETED", {
              completedAtMs: Date.now(),
            }),
        );
      } else {
        // REJECTED / REVISION_REQUIRED → resubmission round (D-224-9)
        taskRow = await transitionRow(
          ctx,
          "task",
          task,
          "IN_PROGRESS",
          (from) => stores.tasks.applyStatus(task.id, from, "IN_PROGRESS"),
        );
      }
      return { submission: reviewed, task: taskRow, agreement: agreementRow };
    },

    listByAgreement: (agreementId) =>
      stores.submissions.listByAgreement(agreementId),
  };
}
