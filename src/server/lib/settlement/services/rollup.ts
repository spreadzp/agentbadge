/**
 * EPIC-227 / SLICE-227-8 — shared intent→milestone→plan rollup
 * (arc-audit H1). One canonical "everything paid → roll up", called by
 * `markLegPaid`; SPLIT re-legs roll up through the next mark-paid —
 * dispute resolution itself re-legs and reopens only. CANCELLED legs
 * never block: every non-cancelled leg must be COMPLETED, ≥1 of them.
 * Milestone + plan are re-read inside the caller's atomic section —
 * no stale-status writes, no phantom `plan.completed` events (M2).
 * Events go through the caller's emit buffer (`buf`) so a rolled-back
 * section leaves nothing behind (R3-M2).
 */
import type {
  MilestoneRow,
  PayoutIntentRow,
} from "@agentbadge/database";
import type { SettlementStores } from "@agentbadge/database";

import type { SettlementEmitBuffer } from "../events.js";
import { isLegalTransition } from "../state-machines.js";

export interface RollupResult {
  intent: PayoutIntentRow;
  milestone: MilestoneRow;
  /** true when this call actually transitioned intent → COMPLETED. */
  rolledUp: boolean;
}

export async function rollupIntent(
  buf: SettlementEmitBuffer,
  s: SettlementStores,
  intent: PayoutIntentRow,
  milestone: MilestoneRow,
  planId: string,
  operator: string,
): Promise<RollupResult | "MOVED"> {
  const legs = await s.payoutLegs.listByIntent(intent.id);
  const payable = legs.filter((l) => l.status !== "CANCELLED");
  if (payable.length === 0 || !payable.every((l) => l.status === "COMPLETED")) {
    return { intent, milestone, rolledUp: false };
  }
  // M-C: gate the milestone BEFORE writing the intent — a live
  // milestone that can't release (e.g. DISPUTED by a concurrent raise)
  // must abort the rollup, not strand a COMPLETED intent over a
  // milestone that can never reach RELEASED.
  const liveM = await s.milestones.getById(milestone.id);
  if (
    liveM?.status !== "APPROVED" ||
    !isLegalTransition("milestone", "APPROVED", "RELEASED")
  ) {
    return "MOVED";
  }
  const ic = await s.payoutIntents.applyStatus(intent.id, "OPEN", "COMPLETED", {
    completedAtMs: Date.now(),
    completedBy: operator,
  });
  if (!ic) return "MOVED";
  buf.emit({
    entityType: "payout_intent",
    entityId: intent.id,
    eventType: "intent.completed",
    actorWallet: operator,
    payload: { milestoneRef: intent.milestoneRef },
  });

  let nextMilestone = milestone;
  const rel = await s.milestones.applyStatus(
    milestone.id,
    "APPROVED",
    "RELEASED",
  );
  if (rel) {
    nextMilestone = rel;
    buf.emit({
      entityType: "milestone",
      entityId: milestone.id,
      eventType: "milestone.released",
      actorWallet: operator,
      payload: { intentId: intent.id },
    });
  }

  if (nextMilestone.status === "RELEASED") {
    const siblings = await s.milestones.listByPlan(planId);
    if (
      siblings.every((m) =>
        ["RELEASED", "CANCELLED"].includes(
          m.id === milestone.id ? "RELEASED" : m.status,
        ),
      )
    ) {
      const pc = await s.plans.applyStatus(planId, "ACTIVE", "COMPLETED");
      if (pc) {
        buf.emit({
          entityType: "settlement_plan",
          entityId: planId,
          eventType: "plan.completed",
          actorWallet: operator,
          payload: {},
        });
      }
    }
  }
  return { intent: ic, milestone: nextMilestone, rolledUp: true };
}
