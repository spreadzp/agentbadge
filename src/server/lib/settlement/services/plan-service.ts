/**
 * EPIC-227 / SLICE-227-2 — milestone plan creation + read models.
 *
 * createPlan: participant-only write; sum(milestones.amountUsd)
 * equals totalUsd (D-227-3 conservation); per-milestone leg
 * templates validated the same way (sum == amountUsd, D-227-5);
 * one plan per agreementRef — re-create is a natural dedupe.
 */

import type { MilestoneRow } from "@agentbadge/database";
import type { JsonValue } from "@prisma/orm-postgres/target/codec-types";

import {
  MAX_ID_FIELD,
  assertAmount,
  checkField,
  checkMilestoneInputs,
  isEvmAddress,
  isParticipant,
} from "../invariants.js";
import {
  type CreatePlanInput,
  type SettlementResult,
  fail,
  ok,
} from "../types.js";
import type { SettlementCtx } from "./ctx.js";
import { newMilestoneRowId, newPlanId } from "./ctx.js";

// ---------- queries ----------

export async function getPlanByAgreement(
  ctx: SettlementCtx,
  agreementRef: string,
) {
  return ctx.db.settlement.plans.getByAgreement(agreementRef);
}

/** Full aggregate for the agreement-detail route read. */
export async function getAgreementView(
  ctx: SettlementCtx,
  agreementRef: string,
) {
  const plan = await ctx.db.settlement.plans.getByAgreement(agreementRef);
  if (!plan) return null;
  const milestones = await ctx.db.settlement.milestones.listByPlan(plan.id);
  const intents = (
    await Promise.all(
      milestones.map((m) =>
        ctx.db.settlement.payoutIntents.getByMilestone(m.id),
      ),
    )
  ).filter((i): i is NonNullable<typeof i> => i != null);
  const legs = (
    await Promise.all(
      intents.map((i) => ctx.db.settlement.payoutLegs.listByIntent(i.id)),
    )
  ).flat();
  const disputes = (
    await Promise.all([
      ctx.db.settlement.disputes.listBySubject("AGREEMENT", agreementRef),
      ...milestones.map((m) =>
        ctx.db.settlement.disputes.listBySubject("MILESTONE", m.id),
      ),
    ])
  ).flat();
  return { plan, milestones, intents, legs, disputes };
}

// ---------- commands ----------

export async function createPlan(
  ctx: SettlementCtx,
  input: CreatePlanInput,
  actorWallet: string,
): Promise<
  SettlementResult<{
    plan: NonNullable<Awaited<ReturnType<typeof getPlanByAgreement>>>;
    milestones: MilestoneRow[];
    duplicate: boolean;
  }>
> {
  // ---- guards first — no write on a negative path ----
  const ref = checkField(input.agreementRef, "agreementRef", MAX_ID_FIELD);
  if (ref) return ref;
  if (
    typeof input.buyerWallet !== "string" ||
    typeof input.providerWallet !== "string" ||
    !isEvmAddress(input.buyerWallet) ||
    !isEvmAddress(input.providerWallet)
  ) {
    return fail(
      "BAD_INPUT",
      "buyerWallet/providerWallet must be EVM addresses",
    );
  }
  if (input.buyerWallet.toLowerCase() === input.providerWallet.toLowerCase()) {
    return fail("BAD_INPUT", "buyerWallet and providerWallet must differ");
  }
  const currency = input.currency ?? "USDC";
  if (currency.length > 16) {
    return fail("BAD_INPUT", "currency must be ≤16 chars");
  }
  const amt = assertAmount(input.totalUsd, "totalUsd");
  if (amt) return amt;
  const mcheck = checkMilestoneInputs(input.milestones, input.totalUsd);
  if (mcheck) return mcheck;
  if (!isParticipant(actorWallet, input.buyerWallet, input.providerWallet)) {
    return fail(
      "FORBIDDEN",
      "only the agreement buyer or provider may create its milestone plan",
    );
  }

  return ctx.db.settlement.atomic(async (s) => {
    // Natural dedupe — one plan per agreement (unique agreementRef).
    const existing = await s.plans.getByAgreement(input.agreementRef);
    if (existing) {
      return ok({
        plan: existing,
        milestones: await s.milestones.listByPlan(existing.id),
        duplicate: true,
      });
    }
    const plan = await s.plans.create({
      id: newPlanId(),
      agreementRef: input.agreementRef,
      buyerWallet: input.buyerWallet,
      providerWallet: input.providerWallet,
      currency,
      totalUsd: input.totalUsd,
      status: "ACTIVE",
      payload: { createdBy: actorWallet },
    });
    if (!plan) {
      // Lost the unique race — surface the winner, same as dedupe.
      const winner = await s.plans.getByAgreement(input.agreementRef);
      if (winner) {
        return ok({
          plan: winner,
          milestones: await s.milestones.listByPlan(winner.id),
          duplicate: true,
        });
      }
      return fail("PROVIDER_ERROR", "plan insert conflicted");
    }
    const milestones: MilestoneRow[] = [];
    for (const [seq, m] of input.milestones.entries()) {
      const row = await s.milestones.create({
        id: newMilestoneRowId(),
        planId: plan.id,
        milestoneId: m.milestoneId,
        seq,
        title: m.title,
        amountUsd: m.amountUsd,
        acceptanceCriteria: m.acceptanceCriteria ?? null,
        dueAtMs: m.dueAtMs ?? null,
        releasePolicy: m.releasePolicy ?? "BUYER_ACCEPT",
        status: "PENDING",
        payload: (m.legs ? { payoutTemplate: m.legs } : {}) as JsonValue,
      });
      if (!row) {
        throw new Error(
          `milestone insert conflict: ${m.milestoneId} — aborting plan create`,
        );
      }
      milestones.push(row);
    }
    await ctx.emit.emit({
      entityType: "settlement_plan",
      entityId: plan.id,
      eventType: "plan.created",
      actorWallet,
      payload: {
        agreementRef: plan.agreementRef,
        totalUsd: plan.totalUsd,
        currency: plan.currency ?? "USDC",
        milestoneCount: milestones.length,
      },
    });
    for (const m of milestones) {
      await ctx.emit.emit({
        entityType: "milestone",
        entityId: m.id,
        eventType: "milestone.created",
        actorWallet,
        payload: { planId: plan.id, milestoneId: m.milestoneId, seq: m.seq },
      });
    }
    return ok({ plan, milestones, duplicate: false });
  });
}
