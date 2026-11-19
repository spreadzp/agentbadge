/**
 * EPIC-227 / SLICE-227-8 — R9-M1 operator exit: audited
 * APPROVED→PENDING release. This is the escape the `repair` log key
 * points at: a resolver-restored (`rsv_`) or force-minted (`ops_`)
 * approval left standing under a rejected submission can be un-done
 * ONLY here — buyer verdicts may not. It is intentionally not
 * epoch-restricted: an operator may also un-accept an `appr_`
 * approval while the agreement is ACTIVE (the audit row records it).
 * Shares revertApproval's guards: a paid leg or a dispute-owned
 * (FROZEN) intent refuses the release.
 */
import { logger } from "@agentbadge/passport/logger";

import { recordPostEffectAudit } from "../../finops/admin-actions.js";
import { normalizeOperator } from "../../finops/guards.js";
import { type SettlementResult, fail, ok } from "../types.js";
import { checkReleasableAgreement } from "./agreement-guard.js";
import type { SettlementCtx } from "./ctx.js";
import { checkForceInput, sha256Hex } from "./milestone-force.js";
import { revertApproval } from "./milestone-revert.js";

export async function forceReleaseMilestone(
  ctx: SettlementCtx,
  milestoneRowId: string,
  opts: { operator: string; reason: string },
): Promise<
  SettlementResult<{ released: boolean; auditRecorded: boolean }>
> {
  const bad = checkForceInput(opts);
  if (bad) return bad as SettlementResult<never>;
  const operator = normalizeOperator(opts.operator);
  const milestone = await ctx.db.settlement.milestones.getById(milestoneRowId);
  if (!milestone) {
    return fail("NOT_FOUND", `milestone not found: ${milestoneRowId}`);
  }
  if (milestone.status !== "APPROVED") {
    return fail(
      "INVALID_STATE",
      `milestone is ${milestone.status}, not APPROVED — nothing to release`,
    );
  }
  // R10-M1 + R11-M1: releasing under a closed commerce agreement or
  // while a verdict is in flight orphans/races the milestone — the
  // shared guard owns the checks (fail-closed on read errors).
  const plan = await ctx.db.settlement.plans.getById(milestone.planId);
  if (!plan) {
    return fail("NOT_FOUND", `plan not found: ${milestone.planId}`);
  }
  const blocked = await checkReleasableAgreement(ctx, plan, milestone);
  if (blocked) return blocked;
  const res = await revertApproval(ctx, milestoneRowId, operator, {
    release: true,
    admin: true,
    eventReason: "operator_release",
  });
  if (!res.ok) return res;
  if (!res.value.reverted) {
    // R10-M3: in-atomic refusals are NOT a 200 success — the operator
    // needs the refusal class to pick the next action. R11 nit 9:
    // `details.reason` is machine-readable — no prose parsing.
    const reason = res.value.reason ?? "unknown";
    return fail(
      "INVALID_STATE",
      `release refused inside the atomic (${reason})`,
      { reason },
    );
  }
  // R11-M2: the guard is a non-atomic cross-store pre-read — a
  // completion pass can still complete the agreement between our read
  // and the revert's CAS. Cannot roll back — but it must be
  // operator-visible, not silent.
  try {
    const agreement = await ctx.db.commerce.agreements.getById(
      plan.agreementRef,
    );
    if (agreement && ["COMPLETED", "CANCELLED"].includes(agreement.status)) {
      logger.error("milestone orphaned after release", {
        repair: "orphaned milestone after release",
        milestoneId: milestone.id,
        agreementRef: plan.agreementRef,
        agreementStatus: agreement.status,
        exit: "buyer/provider raises a dispute resolved FOR_BUYER (or a new plan supersedes)",
      });
    }
  } catch {
    // best-effort post-check — the release already landed
  }
  const audit = await recordPostEffectAudit(
    ctx.db,
    {
      action: "FORCE_RELEASE_MILESTONE",
      subjectType: "milestone",
      subjectId: milestone.id,
      operator,
      evidence: {
        milestoneId: milestone.milestoneId,
        planId: milestone.planId,
        reason: opts.reason,
        reasonSha256: await sha256Hex(opts.reason),
        boundSubmissionRef: milestone.submissionRef ?? null,
        // R11 nit 5: the epoch the ATOMIC actually reverted — the
        // pre-read `milestone.escrowRef` could be stale under a race.
        approvalEpoch: res.value.epoch ?? null,
        fromStatus: "APPROVED",
        toStatus: "PENDING",
      },
    },
    {
      milestoneId: milestone.milestoneId,
      outcome: "PENDING",
      boundSubmissionRef: milestone.submissionRef ?? null,
      reasonPrefix: [...opts.reason].slice(0, 200).join(""),
      reasonSha256: await sha256Hex(opts.reason),
    },
  );
  if (!audit.ok) {
    logger.error("force-release audit row lost", {
      milestoneId: milestone.id,
      operator,
      error: audit.error?.message,
    });
  }
  return ok({ released: true, auditRecorded: audit.ok });
}
