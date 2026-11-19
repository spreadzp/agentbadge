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
  const res = await revertApproval(ctx, milestoneRowId, operator, {
    release: true,
  });
  if (!res.ok) return res;
  if (!res.value.reverted) {
    // Refused inside the atomic (paid leg / unexpected intent state) —
    // the revert already error-logged the cause; no audit row because
    // no effect landed.
    return ok({
      released: false,
      auditRecorded: false,
    });
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
