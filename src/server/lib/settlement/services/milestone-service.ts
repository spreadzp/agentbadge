/**
 * EPIC-227 / SLICE-227-2 — milestone lifecycle service.
 *
 * - submitForReview: provider-only, PENDING→READY (+submissionRef).
 * - approveMilestone: buyer-only, READY→APPROVED; creates the
 *   PayoutIntent OPEN with legs (template from plan-create payload,
 *   else a single PROVIDER leg of the full amount — D-227-5 default).
 * - Release/cancel paths live in payout-/dispute-service.
 */

import type { MilestoneRow } from "@agentbadge/database";

import { MAX_ID_FIELD, checkField } from "../invariants.js";
import { isLegalTransition } from "../state-machines.js";
import {
  type PayoutLegInput,
  type SettlementResult,
  fail,
  ok,
} from "../types.js";
import type { SettlementCtx } from "./ctx.js";
import { newIntentId, newLegId } from "./ctx.js";

/** Guarded single-row transition + event — shared by lifecycle ops. */
export async function transitionMilestone(
  ctx: SettlementCtx,
  milestone: MilestoneRow,
  to: string,
  actorWallet: string,
  patch?: { submissionRef?: string | null; escrowRef?: string | null },
): Promise<SettlementResult<MilestoneRow>> {
  if (!isLegalTransition("milestone", milestone.status, to)) {
    return fail(
      "INVALID_STATE",
      `milestone ${milestone.status} cannot transition to ${to}`,
    );
  }
  const updated = await ctx.db.settlement.milestones.applyStatus(
    milestone.id,
    milestone.status,
    to,
    patch,
  );
  if (!updated) {
    return fail(
      "INVALID_STATE",
      `milestone moved concurrently — expected ${milestone.status}`,
    );
  }
  await ctx.emit.emit({
    entityType: "milestone",
    entityId: milestone.id,
    eventType: `milestone.${to.toLowerCase()}`,
    actorWallet,
    payload: { from: milestone.status, to, milestoneId: milestone.milestoneId },
  });
  return ok(updated);
}

/** Provider submits work for the milestone (or binds a submissionRef). */
export async function submitForReview(
  ctx: SettlementCtx,
  input: { milestoneRowId: string; submissionRef?: string },
  actorWallet: string,
): Promise<SettlementResult<MilestoneRow>> {
  const milestone = await ctx.db.settlement.milestones.getById(
    input.milestoneRowId,
  );
  if (!milestone) {
    return fail("NOT_FOUND", `milestone not found: ${input.milestoneRowId}`);
  }
  const plan = await ctx.db.settlement.plans.getById(milestone.planId);
  if (!plan) {
    return fail("NOT_FOUND", `plan not found: ${milestone.planId}`);
  }
  if (actorWallet.toLowerCase() !== plan.providerWallet.toLowerCase()) {
    return fail("FORBIDDEN", "only the provider may submit for a milestone");
  }
  // M1: participant paths use explicit statuses — DISPUTED→READY is a
  // resolver-only edge, not a provider one.
  if (milestone.status !== "PENDING") {
    return fail(
      "INVALID_STATE",
      `milestone is ${milestone.status}, not PENDING — cannot submit`,
    );
  }
  if (plan.status !== "ACTIVE") {
    return fail(
      "INVALID_STATE",
      `plan is ${plan.status} — submissions closed`,
    );
  }
  if (input.submissionRef !== undefined) {
    const c = checkField(input.submissionRef, "submissionRef", MAX_ID_FIELD);
    if (c) return c as SettlementResult<never>;
  }
  return transitionMilestone(ctx, milestone, "READY", actorWallet, {
    submissionRef: input.submissionRef ?? null,
  });
}

/**
 * Buyer accepts the milestone work → APPROVED + PayoutIntent OPEN with
 * legs (template from plan create, else a single PROVIDER leg of the
 * full amount to the provider wallet — D-227-5 default).
 */
export async function approveMilestone(
  ctx: SettlementCtx,
  milestoneRowId: string,
  actorWallet: string,
): Promise<
  SettlementResult<{
    milestone: MilestoneRow;
    intentId: string;
    legs: string[];
  }>
> {
  const milestone = await ctx.db.settlement.milestones.getById(milestoneRowId);
  if (!milestone) {
    return fail("NOT_FOUND", `milestone not found: ${milestoneRowId}`);
  }
  const plan = await ctx.db.settlement.plans.getById(milestone.planId);
  if (!plan) {
    return fail("NOT_FOUND", `plan not found: ${milestone.planId}`);
  }
  if (milestone.releasePolicy !== "BUYER_ACCEPT") {
    // EVALUATOR_VERDICT seam — v1 approves only through buyer accept.
    return fail(
      "INVALID_STATE",
      `releasePolicy ${milestone.releasePolicy} cannot be buyer-approved`,
    );
  }
  if (actorWallet.toLowerCase() !== plan.buyerWallet.toLowerCase()) {
    return fail("FORBIDDEN", "only the buyer may approve a milestone");
  }
  // M1: buyer approve requires submitted work — DISPUTED→APPROVED is
  // resolver-only, and an OPEN dispute freezes the milestone anyway.
  if (milestone.status !== "READY") {
    return fail(
      "INVALID_STATE",
      `milestone is ${milestone.status}, not READY — cannot approve`,
    );
  }
  if (plan.status !== "ACTIVE") {
    return fail(
      "INVALID_STATE",
      `plan is ${plan.status} — approvals closed`,
    );
  }
  const openDisputes = await ctx.db.settlement.disputes.listBySubject(
    "MILESTONE",
    milestone.id,
  );
  if (openDisputes.some((d) => d.status === "OPEN")) {
    return fail(
      "INVALID_STATE",
      "milestone has an OPEN dispute — approvals frozen",
    );
  }

  return ctx.db.settlement.atomic(async (s) => {
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
      // R2-H3: milestone is already APPROVED — `return fail` here would
      // commit approved-without-intent dead state that no transition
      // can recover. Throw to roll the atomic back.
      throw new Error(
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
        throw new Error("payout leg insert conflict — aborting approve");
      }
      legIds.push(row.id);
      await ctx.emit.emit({
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
    await ctx.emit.emit({
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
    await ctx.emit.emit({
      entityType: "milestone",
      entityId: milestone.id,
      eventType: "milestone.approved",
      actorWallet,
      payload: { intentId: intent.id },
    });
    return ok({ milestone: updated, intentId: intent.id, legs: legIds });
  });
}
