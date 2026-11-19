/**
 * EPIC-227 / SLICE-227-2 — dispute raising (D-227-7).
 *
 * raiseDispute (participant-only): freezes the connected work —
 * milestone(s) → DISPUTED (pre-status kept on the dispute payload for
 * restore), OPEN intents → FROZEN, OPEN legs → FROZEN, plan → DISPUTED.
 * Re-raising on an already-disputed subject is a natural dedupe.
 * Resolution lives in dispute-resolve.ts.
 */

import type { DisputeRow } from "@agentbadge/database";
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
import { SettlementConflictError } from "../types.js";
import type { SettlementCtx } from "./ctx.js";
import { newDisputeId } from "./ctx.js";

import {
  type FreezeMap,
  openSubjectDispute,
  resolveScope,
} from "./dispute-scope.js";
export {
  type FreezeMap,
  type SubjectScope,
  resolveScope,
} from "./dispute-scope.js";

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
  const existing = await openSubjectDispute(
    ctx.db.settlement,
    input.subjectType,
    input.subjectRef,
  );
  if (existing) {
    return ok({
      dispute: existing,
      frozenIntents: 0,
      frozenLegs: 0,
      duplicate: true,
    });
  }

  // M2 (+R3 nit): a dispute on already-terminal work freezes nothing
  // and only flips the plan to DISPUTED — reject it outright. Applies
  // to AGREEMENT subjects too: an agreement dispute on a terminal plan
  // would land an OPEN dispute with an empty freeze map.
  if (
    scope.milestones.every((m) =>
      ["RELEASED", "CANCELLED"].includes(m.status),
    )
  ) {
    return fail(
      "INVALID_STATE",
      "plan work is terminal — nothing left to dispute",
    );
  }

  const createdAtMs = Date.now();
  const buf = ctx.emit.buffer();
  let res;
  try {
    res = await ctx.db.settlement.atomic(async (s) => {
    // H3: dedupe inside the critical section — two concurrent disputes
    // on the same subject must not both pass the pre-check.
    const dup = await openSubjectDispute(
      s,
      input.subjectType,
      input.subjectRef,
    );
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
    // M-4: the plan row is the serialization point — claiming
    // ACTIVE→DISPUTED before the freeze writes makes two concurrent
    // plan-scope disputes impossible (the loser's CAS is null under
    // READ COMMITTED, no SELECT FOR UPDATE needed), and rejects plans
    // already DISPUTED/terminal outright.
    const claimed = await s.plans.applyStatus(
      scope.plan.id,
      "ACTIVE",
      "DISPUTED",
    );
    if (!claimed) {
      // A competing dispute may have won the plan CAS for THIS same
      // subject — re-read so callers get the documented duplicate
      // shape, not a bare 409.
      const stillRacing = await openSubjectDispute(
        s,
        input.subjectType,
        input.subjectRef,
      );
      if (stillRacing) {
        return ok({
          dispute: stillRacing,
          frozenIntents: 0,
          frozenLegs: 0,
          duplicate: true,
        });
      }
      return fail(
        "INVALID_STATE",
        `plan is ${scope.plan.status} — dispute scope already claimed or closed`,
      );
    }
    const freeze: FreezeMap = { milestones: {}, intentIds: [], legIds: [] };
    for (const scoped of scope.milestones) {
      // H3: re-read inside the section — no stale statuses. R4-M3: a
      // lost CAS aborts the whole dispute (partial freeze strands work).
      const m = (await s.milestones.getById(scoped.id)) ?? scoped;
      if (["PENDING", "READY", "APPROVED"].includes(m.status)) {
        const d = await s.milestones.applyStatus(m.id, m.status, "DISPUTED");
        if (!d) {
          throw new SettlementConflictError(
            `milestone ${m.id} moved during dispute freeze — aborting`,
          );
        }
        freeze.milestones[m.id] = m.status;
      }
      // R4-M3: never freeze an intent whose milestone this dispute did
      // not freeze — its lifecycle follows the milestone. R5: a lost
      // intent/leg CAS likewise aborts (something moved it externally).
      if (freeze.milestones[m.id] === undefined) continue;
      const intent = await s.payoutIntents.getByMilestone(m.id);
      if (intent && intent.status === "OPEN") {
        const f = await s.payoutIntents.applyStatus(intent.id, "OPEN", "FROZEN");
        if (!f) {
          throw new SettlementConflictError(
            `intent ${intent.id} moved during dispute freeze — aborting`,
          );
        }
        freeze.intentIds.push(intent.id);
        for (const leg of await s.payoutLegs.listByIntent(intent.id)) {
          if (leg.status === "OPEN") {
            const fl = await s.payoutLegs.applyStatus(
              leg.id,
              "OPEN",
              "FROZEN",
            );
            if (!fl) {
              throw new SettlementConflictError(
                `leg ${leg.id} moved during dispute freeze — aborting`,
              );
            }
            freeze.legIds.push(leg.id);
          }
        }
        buf.emit({
          entityType: "payout_intent",
          entityId: intent.id,
          eventType: "intent.frozen",
          actorWallet: input.raisedBy,
          payload: { milestoneRef: m.id },
        });
      }
      buf.emit({
        entityType: "milestone",
        entityId: m.id,
        eventType: "milestone.disputed",
        actorWallet: input.raisedBy,
        payload: { from: freeze.milestones[m.id] },
      });
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
      throw new SettlementConflictError(
        `dispute insert conflicted for ${input.subjectType}:${input.subjectRef} — aborting`,
        "INVALID_STATE",
      );
    }
    buf.emit({
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
  } catch (err) {
    if (err instanceof SettlementConflictError) {
      return fail(err.code, err.message);
    }
    throw err;
  }
  if (res.ok) await buf.flush();
  return res;
}
