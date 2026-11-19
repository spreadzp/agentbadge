/**
 * EPIC-227 / SLICE-227-8 — operator force-actions on milestones.
 *
 * forceApproveMilestone (R3-H3): READY→APPROVED + intent when the buyer
 * path is unreachable; forceReopenMilestone (R5-M3): READY→PENDING +
 * unbind for milestones stuck READY by a failed/raced release — the
 * safe operator exit that does NOT pay rejected work.
 *
 * Both bypass participant checks; every landed effect writes an
 * append-only AdminAction (R4-M4: payout-authorizing/state-moving admin
 * calls must leave an audit row — `reason` is mandatory evidence).
 */
import { logger } from "@agentbadge/passport/logger";

import { recordPostEffectAudit } from "../../finops/admin-actions.js";
import {
  checkSerialized,
  normalizeOperator,
  requireOperator,
} from "../../finops/guards.js";
import { MAX_REASON_FIELD } from "../invariants.js";
import { type SettlementResult, fail, ok } from "../types.js";
import type { SettlementCtx } from "./ctx.js";
import { doApprove, type ApproveEffect } from "./milestone-approve.js";
import { reopenMilestone } from "./milestone-service.js";

const sha256Hex = async (v: string): Promise<string> =>
  Buffer.from(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(v)),
  ).toString("hex");

const checkForceInput = (
  opts: { operator: string; reason: string },
): SettlementResult<never> | null => {
  const op = requireOperator(opts.operator);
  if (op) return op as SettlementResult<never>;
  if (typeof opts.reason !== "string" || opts.reason.trim().length === 0) {
    return fail("BAD_INPUT", "reason is required for a force action");
  }
  // R5-M4: bound the reason by SERIALIZED length — raw-length caps let
  // ~4000 control chars expand past the 4 KB evidence row, which drops
  // the justification into the degraded minimal payload.
  return checkSerialized(opts.reason, "reason", MAX_REASON_FIELD) as
    SettlementResult<never> | null;
};

/**
 * R3-H3 operator fallback — force-approve a READY milestone when the
 * buyer path is unreachable. Idempotent on APPROVED only while the
 * intent is still OPEN.
 */
export async function forceApproveMilestone(
  ctx: SettlementCtx,
  milestoneRowId: string,
  opts: { operator: string; reason: string; submissionRef?: string },
): Promise<
  SettlementResult<
    ApproveEffect & { auditRecorded: boolean; alreadyApproved?: boolean }
  >
> {
  const bad = checkForceInput(opts);
  if (bad) return bad as SettlementResult<never>;
  const operator = normalizeOperator(opts.operator);
  const milestone = await ctx.db.settlement.milestones.getById(
    milestoneRowId,
  );
  if (!milestone) {
    return fail("NOT_FOUND", `milestone not found: ${milestoneRowId}`);
  }
  const plan = await ctx.db.settlement.plans.getById(milestone.planId);
  if (!plan) {
    return fail("NOT_FOUND", `plan not found: ${milestone.planId}`);
  }
  if (milestone.status === "APPROVED") {
    const existing = await ctx.db.settlement.payoutIntents.getByMilestone(
      milestone.id,
    );
    // R4-M4: idempotent only while the intent is payable — an
    // APPROVED milestone whose intent CANCELLED/COMPLETED must not
    // replay as "ok".
    if (existing && existing.status === "OPEN") {
      const legs = await ctx.db.settlement.payoutLegs.listByIntent(
        existing.id,
      );
      return ok({
        milestone,
        intentId: existing.id,
        legs: legs.map((l) => l.id),
        auditRecorded: false,
        alreadyApproved: true,
      });
    }
    return fail(
      "INVALID_STATE",
      existing
        ? `intent ${existing.id} is ${existing.status} — force-approve closed`
        : "milestone APPROVED but payout intent missing — needs repair",
    );
  }
  if (milestone.status !== "READY") {
    return fail(
      "INVALID_STATE",
      `milestone is ${milestone.status}, not READY — cannot force-approve`,
    );
  }
  if (plan.status !== "ACTIVE") {
    return fail(
      "INVALID_STATE",
      `plan is ${plan.status} — force-approve closed`,
    );
  }
  const openDisputes = await ctx.db.settlement.disputes.listBySubject(
    "MILESTONE",
    milestone.id,
  );
  if (openDisputes.some((d) => d.status === "OPEN")) {
    return fail(
      "INVALID_STATE",
      "milestone has an OPEN dispute — resolve it first",
    );
  }
  const effect = await doApprove(ctx, plan, milestone, operator, {
    admin: true,
    reason: opts.reason,
    submissionRef: opts.submissionRef ?? null,
  });
  if (!effect.ok) return effect;
  // R5-M4: evidence carries the full forensic context (wallets, amount,
  // prior status, bound submissionRef); the degraded fallback keeps a
  // bounded reason prefix plus its SHA-256 so the justification survives
  // even when the full evidence overflows the 4 KB row.
  const reasonHash = await sha256Hex(opts.reason);
  const audit = await recordPostEffectAudit(
    ctx.db,
    {
      action: "FORCE_APPROVE_MILESTONE",
      subjectType: "milestone",
      subjectId: milestone.id,
      operator,
      evidence: {
        milestoneId: milestone.milestoneId,
        planId: plan.id,
        agreementRef: plan.agreementRef,
        intentId: effect.value.intentId,
        reason: opts.reason,
        reasonSha256: reasonHash,
        submissionRef: opts.submissionRef ?? null,
        boundSubmissionRef: milestone.submissionRef ?? null,
        amountUsd: milestone.amountUsd,
        buyerWallet: plan.buyerWallet,
        providerWallet: plan.providerWallet,
        fromStatus: "READY",
      },
    },
    {
      milestoneId: milestone.milestoneId,
      outcome: "APPROVED",
      intentId: effect.value.intentId,
      reasonPrefix: [...opts.reason].slice(0, 200).join(""),
      reasonSha256: reasonHash,
    },
  );
  if (!audit.ok) {
    logger.error("force-approve audit row lost", {
      milestoneId: milestone.id,
      operator,
      error: audit.error?.message,
    });
  }
  return ok({ ...effect.value, auditRecorded: audit.ok });
}

/**
 * R5-M3 operator recovery — release a milestone stuck READY after a
 * lost/raced reject-release (READY→PENDING + unbind, via
 * `reopenMilestone`). The safe exit that does not pay rejected work
 * (force-approve would). Audited like force-approve.
 */
export async function forceReopenMilestone(
  ctx: SettlementCtx,
  milestoneRowId: string,
  opts: { operator: string; reason: string },
): Promise<SettlementResult<{ reopened: boolean; auditRecorded: boolean }>> {
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
  const res = await reopenMilestone(ctx, milestoneRowId, operator);
  if (!res.ok) return res;
  const audit = await recordPostEffectAudit(
    ctx.db,
    {
      action: "REOPEN_MILESTONE",
      subjectType: "milestone",
      subjectId: milestone.id,
      operator,
      evidence: {
        milestoneId: milestone.milestoneId,
        planId: milestone.planId,
        reason: opts.reason,
        reasonSha256: await sha256Hex(opts.reason),
        boundSubmissionRef: milestone.submissionRef ?? null,
        fromStatus: "READY",
        toStatus: "PENDING",
      },
    },
    {
      milestoneId: milestone.milestoneId,
      outcome: "PENDING",
      reasonPrefix: [...opts.reason].slice(0, 200).join(""),
      reasonSha256: await sha256Hex(opts.reason),
    },
  );
  if (!audit.ok) {
    logger.error("force-reopen audit row lost", {
      milestoneId: milestone.id,
      operator,
      error: audit.error?.message,
    });
  }
  return ok({ reopened: true, auditRecorded: audit.ok });
}
