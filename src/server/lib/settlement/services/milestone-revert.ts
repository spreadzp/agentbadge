/**
 * EPIC-227 / SLICE-227-8 — approval revert (R4-H1).
 *
 * The review's settlement gate approves a milestone BEFORE the commerce
 * verdict commits (pre-commit approve, R3-H3). When that verdict's
 * atomic then fails — a true race between the read-only precheck and
 * the commit — the approval must be undone or the failed request leaves
 * a lasting payment authorization: APPROVED→READY + the intent's
 * OPEN→CANCELLED (only while still OPEN; a FROZEN intent belongs to a
 * dispute and is left alone).
 */
import {
  SettlementConflictError,
  type SettlementResult,
  fail,
  ok,
} from "../types.js";
import type { SettlementCtx } from "./ctx.js";

export async function revertApproval(
  ctx: SettlementCtx,
  milestoneRowId: string,
  actorWallet: string,
): Promise<SettlementResult<{ reverted: boolean }>> {
  const buf = ctx.emit.buffer();
  let res: SettlementResult<{ reverted: boolean }>;
  try {
    res = await ctx.db.settlement.atomic(async (s) => {
      const milestone = await s.milestones.getById(milestoneRowId);
      if (!milestone) {
        return fail("NOT_FOUND", `milestone not found: ${milestoneRowId}`);
      }
      // Idempotent — anything but APPROVED means the verdict path no
      // longer owns this row (already reverted, disputed, released).
      if (milestone.status !== "APPROVED") {
        return ok({ reverted: false });
      }
      const reverted = await s.milestones.applyStatus(
        milestone.id,
        "APPROVED",
        "READY",
      );
      if (!reverted) {
        throw new SettlementConflictError(
          `milestone ${milestone.id} moved during approval revert`,
        );
      }
      const intent = await s.payoutIntents.getByMilestone(milestone.id);
      if (intent && intent.status === "OPEN") {
        const cancelled = await s.payoutIntents.applyStatus(
          intent.id,
          "OPEN",
          "CANCELLED",
        );
        if (cancelled) {
          for (const leg of await s.payoutLegs.listByIntent(intent.id)) {
            if (leg.status === "OPEN") {
              await s.payoutLegs.applyStatus(leg.id, "OPEN", "CANCELLED");
            }
          }
          buf.emit({
            entityType: "payout_intent",
            entityId: intent.id,
            eventType: "intent.cancelled",
            actorWallet,
            payload: { reason: "verdict_not_committed" },
          });
        }
      }
      buf.emit({
        entityType: "milestone",
        entityId: milestone.id,
        eventType: "milestone.ready",
        actorWallet,
        payload: { from: "APPROVED", reason: "verdict_not_committed" },
      });
      return ok({ reverted: true });
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
