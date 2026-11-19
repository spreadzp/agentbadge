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
  /** R6-M2: per-cycle approval token stamped into `escrowRef` — a
   *  revert compares it inside its atomic, so a request can only undo
   *  the approval ITS OWN gate landed (a dispute-restore or later
   *  cycle re-stamps the token and the stale revert is refused). */
  approvalToken: string;
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
      const existing = await s.payoutIntents.getByMilestone(milestone.id);
      if (existing && existing.status !== "CANCELLED") {
        return fail(
          "CONFLICT",
          `payout intent already exists for milestone ${milestone.id}`,
        );
      }
      // R5-H1: a CANCELLED intent is the residue of an approval revert
      // (verdict_not_committed) — re-open it instead of failing on the
      // unique-per-milestone slot forever. R6-M1: the intent is reopened
      // but its old legs are NEVER revived — legs cancelled by a dispute
      // SPLIT live on the same intent row and re-opening them would
      // double-allocate the milestone. Fresh legs from the milestone
      // template are minted instead; the cancelled ones stay as the
      // audit trail of the voided authorization.
      if (existing) {
        const oldLegs = await s.payoutLegs.listByIntent(existing.id);
        if (oldLegs.some((l) => ["COMPLETED", "FAILED"].includes(l.status))) {
          return fail(
            "CONFLICT",
            `cancelled intent ${existing.id} has paid legs — operator repair required`,
          );
        }
      }
      const approvalToken = `appr_${crypto.randomUUID()}`;
      const updated = await s.milestones.applyStatus(
        milestone.id,
        milestone.status,
        "APPROVED",
        { escrowRef: approvalToken },
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
      let intent;
      if (existing) {
        intent = await s.payoutIntents.applyStatus(
          existing.id,
          "CANCELLED",
          "OPEN",
        );
        if (!intent) {
          throw new SettlementConflictError(
            `payout intent ${existing.id} moved during reopen — aborting`,
          );
        }
        buf.emit({
          entityType: "payout_intent",
          entityId: existing.id,
          eventType: "intent.reopened",
          actorWallet,
          payload: {
            milestoneRef: milestone.id,
            reason: "verdict_retried",
          },
        });
      } else {
        intent = await s.payoutIntents.create({
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
      if (!existing) {
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
      }
      buf.emit({
        entityType: "milestone",
        entityId: milestone.id,
        eventType: "milestone.approved",
        actorWallet,
        payload: { intentId: intent.id, ...eventPayload },
      });
      return ok({
        milestone: updated,
        intentId: intent.id,
        legs: legIds,
        approvalToken,
      });
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
