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
import { type SettlementResult, fail, ok } from "../types.js";
import type { SettlementCtx } from "./ctx.js";
import { doApprove, type ApproveEffect } from "./milestone-approve.js";
import { reopenMilestone } from "./milestone-service.js";

const sha256Hex = async (v: string): Promise<string> =>
  Buffer.from(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(v)),
  ).toString("hex");

// R6-M3: the reason cap must leave room for the forensic fields beside
// it in the 4 KB audit row — wallets, ids, refs and overhead run ~600-
// 900 serialized bytes, so 2000 binds where the shared 4000 cap did
// not (a longer reason silently dropped the forensic context into the
// degraded minimal payload).
const MAX_FORCE_REASON = 2000;
/** Operator-supplied submission refs land in evidence + events. */
const MAX_FORCE_SUBMISSION_REF = 256;

const checkForceInput = (
  opts: { operator: string; reason: string; submissionRef?: string },
): SettlementResult<never> | null => {
  const op = requireOperator(opts.operator);
  if (op) return op as SettlementResult<never>;
  if (
    typeof opts.reason !== "string" ||
    !/[\p{L}\p{N}]/u.test(opts.reason)
  ) {
    // R6 nit 5: a reason of only marks/symbols is not "mandatory
    // evidence" — it must contain a letter or digit like the operator
    // label does.
    return fail("BAD_INPUT", "reason is required for a force action");
  }
  // R5-M4: bound the reason by SERIALIZED length — raw-length caps let
  // ~4000 control chars expand past the 4 KB evidence row, which drops
  // the justification into the degraded minimal payload.
  const r = checkSerialized(opts.reason, "reason", MAX_FORCE_REASON);
  if (r) return r as SettlementResult<never>;
  if (opts.submissionRef !== undefined) {
    // R6 nit 6: the ref lands in the event payload AND the audit row —
    // bound it in the core, not only at the route's zod schema.
    const s = checkSerialized(
      opts.submissionRef,
      "submissionRef",
      MAX_FORCE_SUBMISSION_REF,
    );
    if (s) return s as SettlementResult<never>;
  }
  return null;
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
        // The existing approval's epoch — the row carries it.
        approvalToken: milestone.escrowRef ?? "",
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
      // R6-M3: the two submission refs cannot be rejoined through
      // intentId — they must survive in the degraded payload too.
      milestoneId: milestone.milestoneId,
      outcome: "APPROVED",
      intentId: effect.value.intentId,
      submissionRef: opts.submissionRef
        ? [...opts.submissionRef].slice(0, 128).join("")
        : null,
      boundSubmissionRef: milestone.submissionRef ?? null,
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
  // R6 nit 4: defensive — a live OPEN/FROZEN intent under a READY
  // milestone is not reachable today, but releasing here would strand
  // a payable authorization no caller owns. Refuse and surface it.
  const intent = await ctx.db.settlement.payoutIntents.getByMilestone(
    milestone.id,
  );
  if (intent && ["OPEN", "FROZEN"].includes(intent.status)) {
    return fail(
      "INVALID_STATE",
      `intent ${intent.id} is ${intent.status} — reopen closed, needs operator review`,
    );
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
      boundSubmissionRef: milestone.submissionRef ?? null,
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
