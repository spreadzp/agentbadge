/**
 * SLICE-227-8 — the review's settlement gate, extracted under the
 * 300-line cap. Called BEFORE the commerce verdict commits (R3-H3):
 * resolves the bound milestone, runs the approve (so an approve
 * failure keeps the submission retryable instead of a swallowed
 * post-commit miss), and counts not-yet-accepted work that gates
 * agreement completion.
 */
import { conflict } from "../types";
import type { CommerceCtx } from "./ctx";
import type { CommerceSubmissionRow } from "@agentbadge/database";

export interface SettlementGate {
  /** Row id of the milestone the review approved (post-commit resync). */
  milestoneRowId?: string;
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
      const agreement = await stores.agreements
        .getById(pre.agreementId)
        .catch((err: unknown) => {
          throw conflict(
            `agreement lookup failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        });
      if (agreement) {
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
  if (found.status === "READY") {
    const ap = await ctx.settlement!.approveMilestone(found.id, actor);
    if (ap && !ap.ok) {
      throw conflict(
        `milestone approve failed (${ap.error?.code}): ${ap.error?.message ?? "cannot create payout intent"}`,
      );
    }
  }
  // M-D: a pending-count failure fails the review too — completing
  // blind re-opens the unpaid-completion hole.
  return {
    milestoneRowId: found.id,
    pendingAfter: await pendingCount(ctx, pre, found.id),
  };
}

async function pendingCount(
  ctx: CommerceCtx,
  pre: CommerceSubmissionRow,
  excludingRowId?: string,
): Promise<number> {
  try {
    return await ctx.settlement!.pendingMilestoneCount(
      pre.agreementId,
      excludingRowId,
    );
  } catch (err) {
    throw conflict(
      `settlement pending-count failed for ${pre.agreementId}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
