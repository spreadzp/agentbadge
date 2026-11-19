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
  type SettlementResult,
  fail,
  ok,
} from "../types.js";
import type { SettlementCtx } from "./ctx.js";
import { doApprove } from "./milestone-approve.js";

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
 * R4-M5: release a milestone whose bound submission was rejected —
 * READY→PENDING and the submissionRef clears so the resubmission
 * round can rebind it (a REJECT/REVISION_REQUIRED verdict never
 * reverted the milestone, which bricked every later submit: bound
 * submits need PENDING, auto-bind skipped READY).
 */
export async function reopenMilestone(
  ctx: SettlementCtx,
  milestoneRowId: string,
  actorWallet: string,
  opts?: { expectedSubmissionRef?: string },
): Promise<SettlementResult<MilestoneRow>> {
  const milestone = await ctx.db.settlement.milestones.getById(
    milestoneRowId,
  );
  if (!milestone) {
    return fail("NOT_FOUND", `milestone not found: ${milestoneRowId}`);
  }
  // Idempotent — only READY unbinds; any other state belongs to a
  // different flow (approved, disputed, already released).
  if (milestone.status !== "READY") {
    return ok(milestone);
  }
  // R6 nit 9: when the caller names the submission it is releasing,
  // a different binding means a NEWER submission claimed the slot —
  // leave it alone.
  if (
    opts?.expectedSubmissionRef !== undefined &&
    milestone.submissionRef !== opts.expectedSubmissionRef
  ) {
    return ok(milestone);
  }
  return transitionMilestone(ctx, milestone, "PENDING", actorWallet, {
    submissionRef: null,
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
  return doApprove(ctx, plan, milestone, actorWallet);
}
