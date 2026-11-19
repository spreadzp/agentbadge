/**
 * EPIC-227 / SLICE-227-8 — shared approve core (R3-H3 + M-2/M-3).
 *
 * `doApprove` is the atomic READY→APPROVED + intent/legs section used
 * by the buyer path (`approveMilestone`) and the operator fallback
 * (`forceApproveMilestone`) — the recovery seam for milestones
 * stranded READY by a pre-R3 swallowed post-commit failure or an
 * EVALUATOR_VERDICT policy on legacy plans.
 *
 * Events are buffered inside the section and flushed after commit so
 * a rollback never leaves phantom rows in the append-only chain.
 */
import type {
  MilestonePlanRow,
  MilestoneRow,
} from "@agentbadge/database";

import { recordPostEffectAudit } from "../../finops/admin-actions.js";
import {
  checkTextField,
  normalizeOperator,
  requireOperator,
} from "../../finops/guards.js";
import { MAX_REASON_FIELD } from "../invariants.js";
import { isLegalTransition } from "../state-machines.js";
import {
  type PayoutLegInput,
  SettlementConflictError,
  type SettlementResult,
  fail,
  ok,
} from "../types.js";
import type { SettlementCtx } from "./ctx.js";
import { newIntentId, newLegId } from "./ctx.js";

export interface ApproveEffect {
  milestone: MilestoneRow;
  intentId: string;
  legs: string[];
}

/** Atomic READY→APPROVED + payout intent/legs — caller pre-checks
 *  party/policy; this section owns the CAS + insert integrity. */
export async function doApprove(
  ctx: SettlementCtx,
  plan: MilestonePlanRow,
  milestone: MilestoneRow,
  actorWallet: string,
  eventPayload: Record<string, unknown> = {},
): Promise<SettlementResult<ApproveEffect>> {
  const buf = ctx.emit.buffer();
  let res: SettlementResult<ApproveEffect>;
  try {
    res = await ctx.db.settlement.atomic(async (s) => {
      if (!isLegalTransition("milestone", milestone.status, "APPROVED")) {
        return fail(
          "INVALID_STATE",
          `milestone ${milestone.status} cannot be approved`,
        );
      }
      // H2: intent-conflict must fail BEFORE the milestone write — an
      // APPROVED milestone without its intent is dead state.
      if (await s.payoutIntents.getByMilestone(milestone.id)) {
        return fail(
          "CONFLICT",
          `payout intent already exists for milestone ${milestone.id}`,
        );
      }
      const updated = await s.milestones.applyStatus(
        milestone.id,
        milestone.status,
        "APPROVED",
      );
      if (!updated) {
        return fail(
          "INVALID_STATE",
          "milestone moved concurrently — approve aborted",
        );
      }
      // Leg template from plan-create payload, else default provider leg.
      const template =
        (
          milestone.payload as { payoutTemplate?: PayoutLegInput[] } | null
        )?.payoutTemplate ?? [
          {
            payee: plan.providerWallet,
            amountUsdc: milestone.amountUsd,
            role: "PROVIDER" as const,
          },
        ];
      const intent = await s.payoutIntents.create({
        id: newIntentId(),
        milestoneRef: milestone.id,
        executor: "MANUAL",
        status: "OPEN",
        createdAtMs: Date.now(),
        payload: { planId: plan.id, milestoneId: milestone.milestoneId },
      });
      if (!intent) {
        // R2-H3: milestone is already APPROVED — `return fail` would
        // commit approved-without-intent dead state that no transition
        // can recover. Throw to roll the atomic back.
        throw new SettlementConflictError(
          `payout intent insert conflicted for milestone ${milestone.id} — aborting`,
        );
      }
      const legIds: string[] = [];
      for (const leg of template) {
        const row = await s.payoutLegs.create({
          id: newLegId(),
          intentId: intent.id,
          payee: leg.payee,
          amountUsdc: leg.amountUsdc,
          role: leg.role,
          status: "OPEN",
          network: "arc",
          payload: {},
        });
        if (!row) {
          throw new SettlementConflictError(
            "payout leg insert conflict — aborting approve",
          );
        }
        legIds.push(row.id);
        buf.emit({
          entityType: "payout_leg",
          entityId: row.id,
          eventType: "leg.opened",
          actorWallet,
          payload: {
            intentId: intent.id,
            payee: row.payee,
            amountUsdc: row.amountUsdc,
            role: row.role,
          },
        });
      }
      buf.emit({
        entityType: "payout_intent",
        entityId: intent.id,
        eventType: "intent.opened",
        actorWallet,
        payload: {
          milestoneRef: milestone.id,
          executor: intent.executor ?? "MANUAL",
          legs: legIds,
        },
      });
      buf.emit({
        entityType: "milestone",
        entityId: milestone.id,
        eventType: "milestone.approved",
        actorWallet,
        payload: { intentId: intent.id, ...eventPayload },
      });
      return ok({ milestone: updated, intentId: intent.id, legs: legIds });
    });
  } catch (err) {
    if (err instanceof SettlementConflictError) {
      return fail(err.code, err.message);
    }
    throw err;
  }
  if (res.ok) await buf.flush();
  return res;
}

/**
 * R3-H3 operator fallback — force-approve a READY milestone when the
 * buyer path is unreachable (pre-R3 swallowed commit, EVALUATOR verdict
 * on a legacy plan). Bypasses the buyer + releasePolicy checks; the
 * event records `admin: true` + the normalized operator, and every
 * landed effect writes an append-only AdminAction (R4-M4: a
 * buyer-bypassing, payout-authorizing call must leave an audit row —
 * `reason` is mandatory evidence). Idempotent on APPROVED only while
 * the intent is still OPEN.
 */
export async function forceApproveMilestone(
  ctx: SettlementCtx,
  milestoneRowId: string,
  opts: { operator: string; reason: string; submissionRef?: string },
): Promise<
  SettlementResult<ApproveEffect & { auditRecorded: boolean }>
> {
  const op = requireOperator(opts.operator);
  if (op) return op as SettlementResult<never>;
  if (typeof opts.reason !== "string" || opts.reason.trim().length === 0) {
    return fail("BAD_INPUT", "reason is required for a force-approve");
  }
  const rc = checkTextField(opts.reason, "reason", MAX_REASON_FIELD);
  if (rc) return rc as SettlementResult<never>;
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
        submissionRef: opts.submissionRef ?? null,
      },
    },
    { milestoneId: milestone.milestoneId, outcome: "APPROVED" },
  );
  return ok({ ...effect.value, auditRecorded: audit.ok });
}
