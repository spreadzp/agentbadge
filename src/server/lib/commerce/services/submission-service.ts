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
  forbidden,
  guardRejected,
  type SubmissionCreateInput,
  type SubmissionVerdict,
} from "../types";
import { reviewSubmission } from "./submission-review";
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
        const { submission, milestoneRowId } = await stores.atomic(async (tx) => {
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
          // D-227: milestoneRef binds the work unit to a settlement
          // milestone — must resolve inside THIS agreement's plan and
          // still be payable (PENDING). Foreign/stale refs are rejected
          // pre-write; an unwired bridge makes the field meaningless.
          let milestoneRowId: string | null = null;
          if (input.milestoneRef !== undefined && input.milestoneRef !== null) {
            if (!ctx.settlement) {
              throw guardRejected(
                "milestoneRef requires settlement wiring",
                { agreementId },
              );
            }
            const found = await ctx.settlement.findMilestone(
              agreement.id,
              input.milestoneRef,
            );
            if (!found) {
              throw guardRejected(
                `milestoneRef ${input.milestoneRef} not in agreement plan`,
                { agreementId, milestoneRef: input.milestoneRef },
              );
            }
            if (found.status !== "PENDING") {
              throw guardRejected(
                `milestone is ${found.status} — cannot submit against it`,
                { agreementId, milestoneRef: input.milestoneRef },
              );
            }
            milestoneRowId = found.id;
          }
          const submission = await tx.submissions.create({
            id: newId("sub"),
            agreementId: agreement.id,
            providerWallet: provider,
            summary,
            resultUrl: input.resultUrl ?? null,
            milestoneRef: input.milestoneRef ?? null,
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
          return { submission, milestoneRowId };
        });
        // SLICE-227-5: post-commit — drive the settlement milestone to
        // READY. Best-effort: a bridge failure never rolls back the
        // commerce submission; the provider can resync via the API.
        if (submission.milestoneRef && ctx.settlement && milestoneRowId) {
          try {
            await ctx.settlement.submitMilestone(
              milestoneRowId,
              provider,
              submission.id,
            );
          } catch (err) {
            logger.warn("settlement submitMilestone failed", {
              milestoneRef: submission.milestoneRef,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }
        return submission;
      }
    },

    review: (actorWallet, submissionId, verdict, reviewNote) =>
      reviewSubmission(ctx, actorWallet, submissionId, verdict, reviewNote),

    listByAgreement: (agreementId) =>
      stores.submissions.listByAgreement(agreementId),
  };
}
