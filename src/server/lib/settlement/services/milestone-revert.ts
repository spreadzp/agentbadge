/**
 * EPIC-227 / SLICE-227-8 — approval revert (R4-H1, hardened R5).
 *
 * The review's settlement gate approves a milestone BEFORE the commerce
 * verdict commits (pre-commit approve, R3-H3). When that verdict's
 * atomic then fails — a true race between the read-only precheck and
 * the commit — the approval must be undone or the failed request leaves
 * a lasting payment authorization: APPROVED→READY + the intent's
 * OPEN→CANCELLED (only while still OPEN; a FROZEN intent belongs to a
 * dispute and is left alone).
 *
 * R5 hardening:
 * - `intentId` pins the revert to the intent THIS gate created — a
 *   foreign intent is never cancelled.
 * - A COMPLETED/FAILED leg means a payout already ran under this intent
 *   (M-5 window) — the milestone then STAYS APPROVED, nothing is
 *   cancelled, `reverted:false` flags it for operator review.
 * - `release:true` goes APPROVED→PENDING and clears submissionRef in
 *   the same CAS — used when the verdict that raced ahead was a reject
 *   (H-2: avoids the stuck-READY state of R4-M5).
 */
import {
  SettlementConflictError,
  type SettlementResult,
  fail,
  ok,
} from "../types.js";
import type { SettlementCtx } from "./ctx.js";

export interface RevertOptions {
  /** Only cancel the intent the caller itself created (H-2). */
  intentId?: string;
  /** Go straight to PENDING + unbind (verdict committed as reject). */
  release?: boolean;
}

export async function revertApproval(
  ctx: SettlementCtx,
  milestoneRowId: string,
  actorWallet: string,
  opts: RevertOptions = {},
): Promise<SettlementResult<{ reverted: boolean }>> {
  const buf = ctx.emit.buffer();
  const to = opts.release ? "PENDING" : "READY";
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
      const intent = await s.payoutIntents.getByMilestone(milestone.id);
      // H-2: when the caller names the intent it created, a different
      // intent row means the approval belongs to a sibling verdict —
      // leave milestone AND intent untouched.
      if (
        intent &&
        opts.intentId !== undefined &&
        intent.id !== opts.intentId
      ) {
        return ok({ reverted: false });
      }
      if (intent && intent.status === "OPEN") {
        const legs = await s.payoutLegs.listByIntent(intent.id);
        // M-5: a paid leg means money already moved under this intent —
        // the approval must stand; operator review decides the rest.
        if (legs.some((l) => ["COMPLETED", "FAILED"].includes(l.status))) {
          buf.emit({
            entityType: "milestone",
            entityId: milestone.id,
            eventType: "milestone.revert_blocked",
            actorWallet,
            payload: {
              intentId: intent.id,
              reason: "paid_leg_present",
            },
          });
          return ok({ reverted: false });
        }
      }
      const reverted = await s.milestones.applyStatus(
        milestone.id,
        "APPROVED",
        to,
        opts.release ? { submissionRef: null } : undefined,
      );
      if (!reverted) {
        throw new SettlementConflictError(
          `milestone ${milestone.id} moved during approval revert`,
        );
      }
      if (intent && intent.status === "OPEN") {
        const cancelled = await s.payoutIntents.applyStatus(
          intent.id,
          "OPEN",
          "CANCELLED",
        );
        if (cancelled) {
          for (const leg of await s.payoutLegs.listByIntent(intent.id)) {
            if (leg.status === "OPEN") {
              const cl = await s.payoutLegs.applyStatus(
                leg.id,
                "OPEN",
                "CANCELLED",
              );
              if (cl) {
                buf.emit({
                  entityType: "payout_leg",
                  entityId: leg.id,
                  eventType: "leg.cancelled",
                  actorWallet,
                  payload: { intentId: intent.id },
                });
              }
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
        eventType: `milestone.${to.toLowerCase()}`,
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
