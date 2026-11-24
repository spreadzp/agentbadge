/**
 * EPIC-227 / SLICE-227-8 — R5-M3 operator recovery for a milestone
 * stuck READY (extracted from milestone-force.ts under the file cap).
 * READY→PENDING + unbind via `reopenMilestone` — the safe exit that
 * does NOT pay rejected work (force-approve would). Audited like
 * force-approve. R12-M1: under a closed agreement the cleanup lands
 * CANCELLED (`cancelled:true`), not an orphaned PENDING.
 */
import { logger } from "@agentbadge/passport/logger";

import { recordPostEffectAudit } from "../../finops/admin-actions.js";
import { normalizeOperator } from "../../finops/guards.js";
import { type SettlementResult, fail, ok } from "../types.js";
import { checkReleasableAgreement } from "./agreement-guard.js";
import type { SettlementCtx } from "./ctx.js";
import { checkForceInput, sha256Hex } from "./milestone-force.js";
import { reopenMilestone } from "./milestone-service.js";

/**
 * R5-M3 operator recovery — release a milestone stuck READY after a
 * lost/raced reject-release (READY→PENDING + unbind, via
 * `reopenMilestone`). The safe exit that does not pay rejected work
 * (force-approve would). Audited like force-approve. R12-M1: under a
 * closed agreement the cleanup lands CANCELLED (`cancelled:true`),
 * not an orphaned PENDING.
 */
export async function forceReopenMilestone(
  ctx: SettlementCtx,
  milestoneRowId: string,
  opts: {
    operator: string;
    reason: string;
    /** 264-8 — credential principal id for the audit row (D-264-Q13). */
    principalId?: string;
  },
): Promise<
  SettlementResult<{
    reopened: boolean;
    cancelled?: boolean;
    auditRecorded: boolean;
  }>
> {
  const bad = checkForceInput(opts);
  if (bad) return bad as SettlementResult<never>;
  const operator = normalizeOperator(opts.operator);
  const milestone = await ctx.db.settlement.milestones.getById(milestoneRowId);
  if (!milestone) {
    return fail("NOT_FOUND", `milestone not found: ${milestoneRowId}`);
  }
  if (milestone.status !== "READY") {
    return ok({ reopened: false, auditRecorded: false });
  }
  // R6 nit 4: a live OPEN/FROZEN intent under a READY milestone is not
  // reachable today — releasing here would strand a payable
  // authorization no caller owns. Refuse and surface it.
  const intent = await ctx.db.settlement.payoutIntents.getByMilestone(
    milestone.id,
  );
  if (intent && ["OPEN", "FROZEN"].includes(intent.status)) {
    return fail(
      "INVALID_STATE",
      `intent ${intent.id} is ${intent.status} — reopen closed, needs operator review`,
    );
  }
  // R11 nit 4: same guard as force-release — no freeing to a dead
  // PENDING row under a closed agreement / in-flight verdict.
  const plan = await ctx.db.settlement.plans.getById(milestone.planId);
  if (!plan) {
    return fail("NOT_FOUND", `plan not found: ${milestone.planId}`);
  }
  const gate = await checkReleasableAgreement(ctx, plan, milestone);
  if (gate.kind === "refuse") return gate.result;
  // R14-M2: a READY row under a COMPLETED agreement with an ACCEPTED
  // bound submission is a stranded-READY owed entitlement (R3-H3:
  // verdict committed, post-commit approve missed) — force-approve
  // pays it; CANCELLED would destroy it irreversibly. Dead work
  // (REJECTED / no submission) still auto-cancels.
  if (
    gate.kind === "cancel" &&
    gate.agreementStatus === "COMPLETED" &&
    gate.submissionStatus === "ACCEPTED"
  ) {
    return fail(
      "INVALID_STATE",
      "agreement COMPLETED with an ACCEPTED bound submission — this is an owed payout; use force-approve to pay it, not reopen",
      { reason: "would_cancel_accepted_work" },
    );
  }
  // R12-M1: under a closed agreement READY can never be paid — the
  // cleanup lands CANCELLED, not an orphaned PENDING.
  const to = gate.kind === "cancel" ? "CANCELLED" : "PENDING";
  const res = await reopenMilestone(ctx, milestoneRowId, operator, {
    // R12-M2: pin to the binding the operator saw — a resubmission
    // claiming the slot in the gap must not be unbound.
    expectedSubmissionRef: milestone.submissionRef ?? undefined,
    to,
  });
  if (!res.ok) return res;
  // R12-M2 + R13-M1: only a row THIS call transitioned earns the
  // audit row and `reopened:true` — a row that reached the target
  // via a concurrent actor (raced release, second operator) must not
  // mint a false AdminAction under this operator's name.
  if (!res.value.transitioned) {
    return ok({ reopened: false, auditRecorded: false });
  }
  const reasonHash = await sha256Hex(opts.reason);
  const audit = await recordPostEffectAudit(
    ctx.db,
    {
      action: "REOPEN_MILESTONE",
      subjectType: "milestone",
      subjectId: milestone.id,
      operator,
      principalId: opts.principalId,
      evidence: {
        milestoneId: milestone.milestoneId,
        planId: milestone.planId,
        reason: opts.reason,
        reasonSha256: reasonHash,
        boundSubmissionRef: milestone.submissionRef ?? null,
        fromStatus: "READY",
        toStatus: to,
      },
    },
    {
      milestoneId: milestone.milestoneId,
      outcome: to,
      boundSubmissionRef: milestone.submissionRef ?? null,
      reasonPrefix: [...opts.reason].slice(0, 200).join(""),
      reasonSha256: reasonHash,
    },
  );
  if (!audit.ok) {
    logger.error("force-reopen audit row lost", {
      milestoneId: milestone.id,
      operator,
      error: audit.error?.message,
    });
  }
  return ok({
    reopened: true,
    ...(to === "CANCELLED" ? { cancelled: true } : {}),
    auditRecorded: audit.ok,
  });
}
