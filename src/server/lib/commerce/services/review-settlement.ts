/**
 * SLICE-227-8 — the review's settlement gate, extracted under the
 * 300-line cap. Called BEFORE the commerce verdict commits (R3-H3):
 * resolves the bound milestone, runs the approve (so an approve
 * failure keeps the submission retryable instead of a swallowed
 * post-commit miss), and counts not-yet-accepted work that gates
 * agreement completion.
 *
 * R4-H1: the approve commits a payout intent, so NO settlement
 * side-effect (heal, submit-retry, approve) may run before the same
 * preconditions the verdict atomic enforces — buyer identity,
 * submission still SUBMITTED, task under review, agreement ACTIVE.
 * The checks below are a read-only mirror of that atomic; without
 * them a signed stranger (or a REJECT-then-ACCEPT retry) could mint
 * an APPROVED milestone + OPEN intent on a review that 4xxs.
 */
import { conflict, forbidden, guardRejected } from "../types";
import type { CommerceCtx } from "./ctx";
import type { CommerceSubmissionRow } from "@agentbadge/database";

export interface SettlementGate {
  /** Row id of the milestone the review approved (post-commit resync). */
  milestoneRowId?: string;
  /** true only when THIS gate ran the approve — the revert on a
   *  failed verdict must never undo a sibling review's approval
   *  (R4-H1: reverting someone else's APPROVED strands a COMPLETED
   *  agreement with a READY milestone). */
  approvedByUs?: boolean;
  /** Not-yet-accepted milestones left after this one — 0 → agreement
   *  may complete. Unbound submissions count the whole plan (R3-H2). */
  pendingAfter: number;
}

export async function resolveSettlementGate(
  ctx: CommerceCtx,
  actor: string,
  submissionId: string,
): Promise<SettlementGate> {
  const { stores } = ctx;
  const pre = await stores.submissions.getById(submissionId).catch(
    (err: unknown) => {
      throw conflict(
        `submission lookup failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    },
  );
  if (!pre) return { pendingAfter: 0 };

  // ---- R4-H1: read-only commerce preconditions BEFORE settlement ----
  // Mirrors submission-review.ts's atomic exactly (and in the same
  // order). Any failure throws the same typed error the atomic would
  // — but with zero settlement side-effects committed.
  const agreement = await stores.agreements
    .getById(pre.agreementId)
    .catch((err: unknown) => {
      throw conflict(
        `agreement lookup failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    });
  if (!agreement) return { pendingAfter: 0 }; // atomic mustGet → 404
  const task = await stores.tasks.getById(agreement.taskId).catch(
    (err: unknown) => {
      throw conflict(
        `task lookup failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    },
  );
  if (!task) return { pendingAfter: 0 };
  if (task.buyerWallet !== actor) {
    throw forbidden("only the buyer can review a submission");
  }
  if (pre.status !== "SUBMITTED") {
    throw guardRejected(
      `submission is ${pre.status} — already reviewed`,
      { submissionId, status: pre.status },
    );
  }
  if (task.status !== "UNDER_REVIEW" && task.status !== "SUBMITTED") {
    throw guardRejected(`task is ${task.status} — no review pending`, {
      taskId: task.id,
      status: task.status,
    });
  }
  if (agreement.status !== "ACTIVE") {
    throw guardRejected(
      `agreement is ${agreement.status} — review closed`,
      { agreementId: agreement.id, status: agreement.status },
    );
  }

  if (!pre.milestoneRef) {
    // R3-H2: an unbound submission — the agreement completes only when
    // the plan has no not-yet-accepted work left at all.
    return {
      pendingAfter: await pendingCount(ctx, pre),
    };
  }
  // M-D: the settlement lookup is guarded — a store failure here
  // becomes a typed 409, not an unhandled throw out of the review.
  let found: { id: string; status: string } | null;
  try {
    found = await ctx.settlement!.findMilestone(
      pre.agreementId,
      pre.milestoneRef,
    );
  } catch (err) {
    throw conflict(
      `settlement lookup failed for milestoneRef ${pre.milestoneRef}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  // R2-H5: a bound-but-unresolved milestoneRef must fail the review
  // — completing the agreement with pendingAfter=0 pays nobody.
  if (!found) {
    throw conflict(
      `milestoneRef ${pre.milestoneRef} does not resolve on the settlement plan for ${pre.agreementId}`,
    );
  }
  if (found.status !== "READY" && found.status !== "APPROVED") {
    // R2-H5 heal: the submit-time bridge call may have failed —
    // retry it once rather than stranding the milestone.
    // (APPROVED is a valid resume state — a prior review's approve
    // landed but its verdict commit did not.)
    if (found.status === "PENDING") {
      // nit: all bridge/store calls on this path are guarded — a
      // store outage must surface as a typed 409, not a 500.
      await ctx.settlement!.submitMilestone(
        found.id,
        agreement.providerWallet,
        pre.id,
      ).catch((err: unknown) => {
        throw conflict(
          `settlement submit heal failed for ${pre.milestoneRef}: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    }
    const recheck = await ctx.settlement!.findMilestone(
      pre.agreementId,
      pre.milestoneRef,
    ).catch(() => null);
    if (recheck?.status !== "READY" && recheck?.status !== "APPROVED") {
      throw conflict(
        `milestone ${pre.milestoneRef} is ${recheck?.status ?? "missing"}, not READY — review cannot approve it`,
      );
    }
    found = recheck;
  }
  // R3-H3: approve BEFORE the verdict commits — a failure here keeps
  // the submission SUBMITTED (retryable) instead of a swallowed
  // post-commit miss with no recovery path. APPROVED pre-read = the
  // prior review's approve landed; skip re-approving.
  let approvedByUs = false;
  if (found.status === "READY") {
    // nit: the bridge call itself is guarded — a thrown store error
    // becomes a typed 409, and an empty result is not a success.
    const ap = await ctx.settlement!.approveMilestone(found.id, actor)
      .catch((err: unknown) => {
        throw conflict(
          `milestone approve call failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    if (!ap?.ok) {
      throw conflict(
        `milestone approve failed (${ap?.error?.code ?? "UNKNOWN"}): ${ap?.error?.message ?? "cannot create payout intent"}`,
      );
    }
    approvedByUs = true;
  }
  // M-D: a pending-count failure fails the review too — completing
  // blind re-opens the unpaid-completion hole.
  return {
    milestoneRowId: found.id,
    approvedByUs,
    pendingAfter: await pendingCount(ctx, pre, found.id),
  };
}

async function pendingCount(
  ctx: CommerceCtx,
  pre: CommerceSubmissionRow,
  excludingRowId?: string,
): Promise<number> {
  let n: number | null;
  try {
    n = await ctx.settlement!.pendingMilestoneCount(
      pre.agreementId,
      excludingRowId,
    );
  } catch (err) {
    throw conflict(
      `settlement pending-count failed for ${pre.agreementId}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  // R4-M6: null = "no plan exists" — the payable state cannot be
  // proven, so the review must not proceed (0 would complete the
  // agreement with nobody paid).
  if (n === null) {
    throw conflict(
      `no settlement plan for agreement ${pre.agreementId} — cannot prove payable state`,
    );
  }
  return n;
}
