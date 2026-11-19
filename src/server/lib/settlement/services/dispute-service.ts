/**
 * EPIC-227 / SLICE-227-2 — dispute raising (D-227-7).
 *
 * raiseDispute (participant-only): freezes the connected work —
 * milestone(s) → DISPUTED (pre-status kept on the dispute payload for
 * restore), OPEN intents → FROZEN, OPEN legs → FROZEN, plan → DISPUTED.
 * Re-raising on an already-disputed subject is a natural dedupe.
 * Resolution lives in dispute-resolve.ts.
 */

import type {
  DisputeRow,
  MilestonePlanRow,
  MilestoneRow,
} from "@agentbadge/database";
import type { JsonValue } from "@prisma/orm-postgres/target/codec-types";

import {
  MAX_ID_FIELD,
  MAX_REASON_FIELD,
  checkEvidenceRefs,
  checkField,
  checkSubjectType,
  isParticipant,
} from "../invariants.js";
import {
  type RaiseDisputeInput,
  type SettlementResult,
  fail,
  ok,
} from "../types.js";
import type { SettlementCtx } from "./ctx.js";
import { newDisputeId } from "./ctx.js";

export interface FreezeMap {
  /** milestoneRowId → status before the freeze. */
  milestones: Record<string, string>;
  intentIds: string[];
  legIds: string[];
}

export interface SubjectScope {
  plan: MilestonePlanRow;
  milestones: MilestoneRow[];
}

/** AGREEMENT → plan + all its milestones; MILESTONE → row + its plan. */
export async function resolveScope(
  ctx: SettlementCtx,
  subjectType: string,
  subjectRef: string,
): Promise<SubjectScope | null> {
  if (subjectType === "AGREEMENT") {
    const plan = await ctx.db.settlement.plans.getByAgreement(subjectRef);
    if (!plan) return null;
    return {
      plan,
      milestones: await ctx.db.settlement.milestones.listByPlan(plan.id),
    };
  }
  const milestone = await ctx.db.settlement.milestones.getById(subjectRef);
  if (!milestone) return null;
  const plan = await ctx.db.settlement.plans.getById(milestone.planId);
  if (!plan) return null;
  return { plan, milestones: [milestone] };
}

export async function raiseDispute(
  ctx: SettlementCtx,
  input: RaiseDisputeInput,
): Promise<
  SettlementResult<{
    dispute: DisputeRow;
    frozenIntents: number;
    frozenLegs: number;
    duplicate: boolean;
  }>
> {
  const st = checkSubjectType(input.subjectType);
  if (st) return st;
  const ref = checkField(input.subjectRef, "subjectRef", MAX_ID_FIELD);
  if (ref) return ref;
  const reason = checkField(input.reason, "reason", MAX_REASON_FIELD);
  if (reason) return reason;
  const refs = checkEvidenceRefs(input.evidenceRefs);
  if (!refs.ok) return refs;
  if (typeof input.raisedBy !== "string" || input.raisedBy.length === 0) {
    return fail("BAD_INPUT", "raisedBy wallet is required");
  }

  const scope = await resolveScope(ctx, input.subjectType, input.subjectRef);
  if (!scope) {
    return fail(
      "NOT_FOUND",
      `${input.subjectType} subject not found: ${input.subjectRef}`,
    );
  }
  // Participant-only — a stranger's dispute must not freeze real work.
  if (
    !isParticipant(
      input.raisedBy,
      scope.plan.buyerWallet,
      scope.plan.providerWallet,
    )
  ) {
    return fail(
      "FORBIDDEN",
      "only the agreement buyer or provider may raise a dispute",
    );
  }
  // Dedupe — an OPEN dispute on this subject already froze it.
  const open = await ctx.db.settlement.disputes.listBySubject(
    input.subjectType,
    input.subjectRef,
  );
  const existing = open.find((d) => d.status === "OPEN");
  if (existing) {
    return ok({
      dispute: existing,
      frozenIntents: 0,
      frozenLegs: 0,
      duplicate: true,
    });
  }

  // M2: a dispute on already-terminal work freezes nothing and only
  // flips the plan to DISPUTED — reject it outright.
  if (
    input.subjectType === "MILESTONE" &&
    scope.milestones.every((m) =>
      ["RELEASED", "CANCELLED"].includes(m.status),
    )
  ) {
    return fail(
      "INVALID_STATE",
      "milestone is terminal — nothing left to dispute",
    );
  }

  const createdAtMs = Date.now();
  return ctx.db.settlement.atomic(async (s) => {
    // H3: dedupe inside the critical section — two concurrent disputes
    // on the same subject must not both pass the pre-check.
    const racing = await s.disputes.listBySubject(
      input.subjectType,
      input.subjectRef,
    );
    const dup = racing.find((d) => d.status === "OPEN");
    if (dup) {
      return ok({
        dispute: dup,
        frozenIntents: 0,
        frozenLegs: 0,
        duplicate: true,
      });
    }
    // R2-H6: one OPEN dispute per PLAN. A second subject on rows the
    // first dispute froze would record an EMPTY freeze map — its
    // resolve then runs as a silent no-op (FOR_BUYER lost) or unfreezes
    // work the other dispute still holds (FOR_PROVIDER wins over it).
    // Sibling milestone disputes share the plan freeze, so the ban is
    // plan-wide, not subject-wide.
    const scopeSubjects: [string, string][] = [
      ["AGREEMENT", scope.plan.agreementRef],
      ...(await s.milestones.listByPlan(scope.plan.id)).map(
        (m): [string, string] => ["MILESTONE", m.id],
      ),
    ];
    for (const [st, sr] of scopeSubjects) {
      if (st === input.subjectType && sr === input.subjectRef) continue;
      const other = (await s.disputes.listBySubject(st, sr)).find(
        (d) => d.status === "OPEN",
      );
      if (other) {
        return fail(
          "INVALID_STATE",
          `an OPEN dispute (${other.id}) already covers this scope — resolve it first`,
        );
      }
    }
    const freeze: FreezeMap = { milestones: {}, intentIds: [], legIds: [] };
    for (const scoped of scope.milestones) {
      // H3: re-read inside the section — no stale statuses.
      const m = (await s.milestones.getById(scoped.id)) ?? scoped;
      // Only pre-release work freezes; RELEASED/CANCELLED stand.
      if (["PENDING", "READY", "APPROVED"].includes(m.status)) {
        const d = await s.milestones.applyStatus(m.id, m.status, "DISPUTED");
        if (d) freeze.milestones[m.id] = m.status;
      }
      const intent = await s.payoutIntents.getByMilestone(m.id);
      if (intent && intent.status === "OPEN") {
        const f = await s.payoutIntents.applyStatus(intent.id, "OPEN", "FROZEN");
        if (f) {
          freeze.intentIds.push(intent.id);
          for (const leg of await s.payoutLegs.listByIntent(intent.id)) {
            if (leg.status === "OPEN") {
              const fl = await s.payoutLegs.applyStatus(
                leg.id,
                "OPEN",
                "FROZEN",
              );
              if (fl) freeze.legIds.push(leg.id);
            }
          }
          await ctx.emit.emit({
            entityType: "payout_intent",
            entityId: intent.id,
            eventType: "intent.frozen",
            actorWallet: input.raisedBy,
            payload: { milestoneRef: m.id },
          });
        }
      }
      if (freeze.milestones[m.id] !== undefined) {
        await ctx.emit.emit({
          entityType: "milestone",
          entityId: m.id,
          eventType: "milestone.disputed",
          actorWallet: input.raisedBy,
          payload: { from: freeze.milestones[m.id] },
        });
      }
    }
    // Plan freeze — guarded; a second dispute on the same plan is a no-op.
    if (scope.plan.status === "ACTIVE") {
      await s.plans.applyStatus(scope.plan.id, "ACTIVE", "DISPUTED");
    }
    const dispute = await s.disputes.create({
      id: newDisputeId(),
      subjectType: input.subjectType,

      subjectRef: input.subjectRef,
      raisedBy: input.raisedBy,
      reason: input.reason,
      evidenceRefs: refs.value as JsonValue,
      status: "OPEN",
      createdAtMs,
      payload: {
        planId: scope.plan.id,
        freeze,
      } as unknown as JsonValue,
    });
    if (!dispute) {
      // R2-H3: a conflict AFTER the freeze writes must roll the whole
      // atomic back — `return fail` commits frozen work with no
      // dispute row to resolve it (permanent lock).
      throw new Error(
        `dispute insert conflicted for ${input.subjectType}:${input.subjectRef} — aborting`,
      );
    }
    await ctx.emit.emit({
      entityType: "settlement_dispute",
      entityId: dispute.id,
      eventType: "dispute.raised",
      actorWallet: input.raisedBy,
      payload: {
        subjectType: input.subjectType,
        subjectRef: input.subjectRef,
        frozenIntents: freeze.intentIds.length,
      },
    });
    return ok({
      dispute,
      frozenIntents: freeze.intentIds.length,
      frozenLegs: freeze.legIds.length,
      duplicate: false,
    });
  });
}

// ---------- queries ----------

export async function getDispute(ctx: SettlementCtx, disputeId: string) {
  return ctx.db.settlement.disputes.getById(disputeId);
}

export async function listDisputes(
  ctx: SettlementCtx,
  opts?: { status?: string; limit?: number },
) {
  return ctx.db.settlement.disputes.list(opts);
}
