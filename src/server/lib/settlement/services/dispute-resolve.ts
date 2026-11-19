/**
 * EPIC-227 / SLICE-227-2 — dispute resolution (operator-only, D-227-7).
 *
 * FOR_PROVIDER restores the frozen work to its pre-dispute status.
 * SPLIT re-legs the intent per validated amounts (sum must equal the
 * milestone amount; completed legs are immutable). FOR_BUYER cancels
 * milestone + intent + legs. The plan unfreezes to ACTIVE (or
 * COMPLETED when nothing remains) once no OPEN dispute touches it.
 * Every resolution writes an AdminAction — failed ones never do.
 */

import type { DisputeRow } from "@agentbadge/database";
import type { JsonValue } from "@prisma/orm-postgres/target/codec-types";

import { recordPostEffectAudit } from "../../finops/admin-actions.js";
import {
  checkTextField,
  normalizeOperator,
  requireOperator,
} from "../../finops/guards.js";
import {
  MAX_ID_FIELD,
  MAX_REASON_FIELD,
  checkField,
  checkLegTemplate,
  checkResolution,
} from "../invariants.js";
import {
  type ResolveDisputeInput,
  type SettlementResult,
  fail,
  ok,
} from "../types.js";
import type { SettlementCtx } from "./ctx.js";
import { newLegId } from "./ctx.js";
import { type FreezeMap, resolveScope } from "./dispute-service.js";

export async function resolveDispute(
  ctx: SettlementCtx,
  input: ResolveDisputeInput,
): Promise<
  SettlementResult<{ dispute: DisputeRow; auditRecorded: boolean }>
> {
  const op = requireOperator(input.operator);
  if (op) return op as SettlementResult<never>;
  const res = checkResolution(input.resolution);
  if (res) return res;
  if (input.note !== undefined) {
    const n = checkTextField(input.note, "note", MAX_REASON_FIELD);
    if (n) return n as SettlementResult<never>;
  }
  if (input.resolverRef !== undefined) {
    const rr = checkField(input.resolverRef, "resolverRef", MAX_ID_FIELD);
    if (rr) return rr;
  }

  const dispute = await ctx.db.settlement.disputes.getById(input.disputeId);
  if (!dispute) {
    return fail("NOT_FOUND", `dispute not found: ${input.disputeId}`);
  }
  if (dispute.status !== "OPEN") {
    return fail("INVALID_STATE", `dispute is ${dispute.status}, not OPEN`);
  }
  const scope = await resolveScope(ctx, dispute.subjectType, dispute.subjectRef);
  if (!scope) {
    return fail(
      "NOT_FOUND",
      `dispute subject gone: ${dispute.subjectType} ${dispute.subjectRef}`,
    );
  }

  // SPLIT applies to ONE milestone's intent — validate upfront.
  const freeze = (dispute.payload as { freeze?: FreezeMap } | null)?.freeze;
  if (input.resolution === "SPLIT") {
    if (dispute.subjectType !== "MILESTONE" || scope.milestones.length !== 1) {
      return fail(
        "BAD_INPUT",
        "SPLIT resolution requires a MILESTONE-subject dispute",
      );
    }
    const m = scope.milestones[0]!;
    if (freeze?.milestones[m.id] !== "APPROVED") {
      return fail(
        "BAD_INPUT",
        "SPLIT requires the milestone to have been APPROVED (payable)",
      );
    }
    if (!input.splitLegs) {
      return fail(
        "BAD_INPUT",
        "SPLIT resolution requires splitLegs — the replacement legs",
      );
    }
    const lt = checkLegTemplate(input.splitLegs, m.amountUsd, "splitLegs");
    if (lt) return lt;
    // H2: hoist the immutable-leg check above the atomic writes — a
    // completed leg makes SPLIT impossible, and failing after the
    // dispute is marked RESOLVED leaves dead FROZEN state.
    for (const intentId of freeze?.intentIds ?? []) {
      for (const leg of await ctx.db.settlement.payoutLegs.listByIntent(
        intentId,
      )) {
        if (leg.status === "COMPLETED") {
          return fail(
            "INVALID_STATE",
            "cannot SPLIT — a completed leg is immutable",
          );
        }
      }
    }
  }

  const operator = normalizeOperator(input.operator);
  const resolvedAtMs = Date.now();
  const effect = await ctx.db.settlement.atomic(async (s) => {
    // Guarded resolve first — losing the race means another operator
    // already resolved; report the conflict, never double-apply.
    const resolved = await s.disputes.resolve(
      dispute.id,
      input.resolution,
      operator,
      resolvedAtMs,
      {
        splitAmounts: (input.splitLegs ?? null) as unknown as JsonValue | null,
        resolverRef: input.resolverRef ?? null,
      },
    );
    if (!resolved) {
      return fail(
        "INVALID_STATE",
        "dispute resolved concurrently — not applied",
      );
    }
    // H3: operate ONLY on what THIS dispute froze — never on live
    // status (a second OPEN dispute's freeze must survive resolve).
    const frozenIntentIds = new Set(freeze?.intentIds ?? []);
    const frozenLegIds = new Set(freeze?.legIds ?? []);
    for (const scoped of scope.milestones) {
      const m = (await s.milestones.getById(scoped.id)) ?? scoped;
      const prev = freeze?.milestones[m.id];
      const intent = (
        await Promise.all(
          [...frozenIntentIds].map((id) => s.payoutIntents.getById(id)),
        )
      ).find((i) => i?.milestoneRef === m.id);
      if (input.resolution === "FOR_BUYER") {
        if (m.status === "DISPUTED" && prev !== undefined) {
          await s.milestones.applyStatus(m.id, "DISPUTED", "CANCELLED");
        }
        if (intent && intent.status === "FROZEN") {
          await s.payoutIntents.applyStatus(intent.id, "FROZEN", "CANCELLED");
          for (const leg of await s.payoutLegs.listByIntent(intent.id)) {
            if (leg.status === "FROZEN" && frozenLegIds.has(leg.id)) {
              await s.payoutLegs.applyStatus(leg.id, "FROZEN", "CANCELLED");
            }
          }
        }
      } else {
        // FOR_PROVIDER | SPLIT — restore the frozen work to payable.
        if (m.status === "DISPUTED" && prev !== undefined) {
          const to = input.resolution === "SPLIT" ? "APPROVED" : prev;
          await s.milestones.applyStatus(m.id, "DISPUTED", to);
        }
        if (intent && intent.status === "FROZEN") {
          if (input.resolution === "SPLIT") {
            // Re-leg: cancel the frozen legs, create the split set.
            for (const leg of await s.payoutLegs.listByIntent(intent.id)) {
              if (leg.status === "FROZEN" && frozenLegIds.has(leg.id)) {
                await s.payoutLegs.applyStatus(leg.id, "FROZEN", "CANCELLED");
              }
            }
            for (const leg of input.splitLegs ?? []) {
              const row = await s.payoutLegs.create({
                id: newLegId(),
                intentId: intent.id,
                payee: leg.payee,
                amountUsdc: leg.amountUsdc,
                role: leg.role,
                status: "OPEN",
                network: "arc",
                payload: { splitOf: dispute.id },
              });
              if (!row) {
                throw new Error(
                  "split leg insert conflict — aborting resolve",
                );
              }
            }
          } else {
            // FOR_PROVIDER — the freeze lifts: legs return to payable.
            for (const leg of await s.payoutLegs.listByIntent(intent.id)) {
              if (leg.status === "FROZEN" && frozenLegIds.has(leg.id)) {
                await s.payoutLegs.applyStatus(leg.id, "FROZEN", "OPEN");
              }
            }
          }
          await s.payoutIntents.applyStatus(intent.id, "FROZEN", "OPEN");
        }
      }
      if (intent) {
        await ctx.emit.emit({
          entityType: "payout_intent",
          entityId: intent.id,
          eventType:
            input.resolution === "FOR_BUYER"
              ? "intent.cancelled"
              : "intent.unfrozen",
          actorWallet: operator,
          payload: { disputeId: dispute.id, resolution: input.resolution },
        });
      }
    }
    // Plan restore — DISPUTED→ACTIVE only when no OPEN dispute remains
    // on this plan; →COMPLETED when every milestone is terminal.
    const open = await s.disputes.list({ status: "OPEN" });
    const subjectRefs = new Set([
      scope.plan.agreementRef,
      ...scope.milestones.map((m) => m.id),
    ]);
    const stillOpen = open.some(
      (d) => d.id !== dispute.id && subjectRefs.has(d.subjectRef),
    );
    const milestones = await s.milestones.listByPlan(scope.plan.id);
    const allTerminal = milestones.every((m) =>
      ["RELEASED", "CANCELLED"].includes(m.status),
    );
    if (allTerminal) {
      await s.plans.applyStatus(scope.plan.id, "DISPUTED", "COMPLETED");
    } else if (!stillOpen) {
      await s.plans.applyStatus(scope.plan.id, "DISPUTED", "ACTIVE");
    }
    await ctx.emit.emit({
      entityType: "settlement_dispute",
      entityId: dispute.id,
      eventType: "dispute.resolved",
      actorWallet: operator,
      payload: { resolution: input.resolution },
    });
    return ok(resolved);
  });
  if (!effect.ok) return effect;

  // ---- post-effect audit — surfaced, never swallowed ----
  const audit = await recordPostEffectAudit(
    ctx.db,
    {
      action: "RESOLVE_SETTLEMENT_DISPUTE",
      subjectType: "settlement_dispute",
      subjectId: dispute.id,
      operator,
      evidence: {
        resolution: input.resolution,
        note: input.note ?? null,
        resolverRef: input.resolverRef ?? null,
        subjectType: dispute.subjectType,
        subjectRef: dispute.subjectRef,
        planId: scope.plan.id,
      },
    },
    {
      resolution: input.resolution,
      subjectRef: dispute.subjectRef,
      outcome: "RESOLVED",
    },
  );
  return ok({ dispute: effect.value, auditRecorded: audit.ok });
}
