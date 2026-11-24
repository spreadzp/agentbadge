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

export const sha256Hex = async (v: string): Promise<string> =>
  Buffer.from(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(v)),
  ).toString("hex");

// R6-M3: the reason cap leaves room for the forensic fields beside it
// in the 4 KB audit row (~600-900 serialized bytes of wallets/ids/refs).
const MAX_FORCE_REASON = 2000;
/** Operator-supplied submission refs land in evidence + events. */
const MAX_FORCE_SUBMISSION_REF = 256;

export const checkForceInput = (
  opts: { operator: string; reason: string; submissionRef?: string },
): SettlementResult<never> | null => {
  const op = requireOperator(opts.operator);
  if (op) return op as SettlementResult<never>;
  if (typeof opts.reason !== "string" || !/[\p{L}\p{N}]/u.test(opts.reason)) {
    // R6 nit 5: a reason of only marks/symbols is not "mandatory
    // evidence" — it must contain a letter or digit like the operator
    // label does.
    return fail("BAD_INPUT", "reason is required for a force action");
  }
  // R5-M4: bound the reason by SERIALIZED length — raw caps let ~4000
  // control chars overflow the 4 KB evidence row into the degraded
  // minimal payload.
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
  opts: {
    operator: string;
    reason: string;
    submissionRef?: string;
    /** 264-8 — credential principal id for the audit row (D-264-Q13). */
    principalId?: string;
  },
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
    // R4-M4 + R9 nit 3: idempotent ONLY when replaying OUR OWN force
    // (`ops_` epoch). On an `appr_`/`rsv_` milestone the call is a
    // silent no-op that mints no audit row — the operator believes the
    // approval is pinned, but a later REJECT can still release an
    // `appr_` epoch. Refuse so the operator picks the real path
    // (dispute/resolve, or force-release to undo a ruling).
    if (existing && existing.status === "OPEN") {
      const epoch = milestone.escrowRef ?? "";
      if (!epoch.startsWith("ops_")) {
        // R10 nit 3: name the epoch kind — null/legacy ≠ "commerce".
        const kind = epoch.startsWith("rsv_")
          ? "resolver"
          : epoch.startsWith("appr_")
            ? "commerce"
            : "unknown/legacy";
        return fail(
          "INVALID_STATE",
          `already APPROVED by a ${kind} cycle — no-op force-approve refused (use force-release or the dispute path)`,
        );
      }
      const legs = await ctx.db.settlement.payoutLegs.listByIntent(
        existing.id,
      );
      return ok({
        milestone,
        intentId: existing.id,
        legs: legs.map((l) => l.id),
        // The existing approval's epoch — the row carries it.
        approvalToken: epoch,
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
    // R8-M1: `ops_` marks the epoch operator-owned — a buyer's reject
    // release must not undo an explicit force-approve ruling.
  }, "ops");
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
      principalId: opts.principalId,
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

