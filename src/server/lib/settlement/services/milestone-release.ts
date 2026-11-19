/**
 * EPIC-227 / SLICE-227-8 — R9-M1 operator exit: audited
 * APPROVED→PENDING release. This is the escape the `repair` log key
 * points at: a resolver-restored (`rsv_`) or force-minted (`ops_`)
 * approval left standing under a rejected submission can be un-done
 * ONLY here — buyer verdicts may not. Shares revertApproval's
 * guards: a paid leg or a dispute-owned (FROZEN) intent refuses the
 * release.
 */
import { logger } from "@agentbadge/passport/logger";

import { recordPostEffectAudit } from "../../finops/admin-actions.js";
import { normalizeOperator } from "../../finops/guards.js";
import { type SettlementResult, fail, ok } from "../types.js";
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
  // R10-M1: releasing under a CLOSED commerce agreement orphans the
  // milestone — PENDING work nothing can submit or review (submission
  // and review both require an ACTIVE agreement), and the plan stays
  // ACTIVE forever. The remaining exits are paying the OPEN intent or
  // a FOR_BUYER dispute resolution — refuse and say so. A missing
  // agreement row means a pure-settlement plan: proceed.
  const plan = await ctx.db.settlement.plans.getById(milestone.planId);
  if (plan) {
    const agreement = await ctx.db.commerce.agreements
      .getById(plan.agreementRef)
      .catch(() => null);
    if (agreement && agreement.status !== "ACTIVE") {
      return fail(
        "INVALID_STATE",
        `commerce agreement is ${agreement.status} — releasing would orphan the milestone; pay the OPEN intent or resolve a dispute FOR_BUYER instead`,
      );
    }
  }
  const res = await revertApproval(ctx, milestoneRowId, operator, {
    release: true,
    admin: true,
    eventReason: "operator_release",
  });
  if (!res.ok) return res;
  if (!res.value.reverted) {
    // R10-M3: in-atomic refusals are NOT a 200 success — the operator
    // needs the refusal class to pick the next action.
    const reason = res.value.reason ?? "unknown";
    return fail(
      "INVALID_STATE",
      `release refused inside the atomic (${reason}) — see server log`,
    );
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
        approvalEpoch: milestone.escrowRef ?? null,
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
