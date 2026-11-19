/**
 * EPIC-227 / SLICE-227-8 — approval revert (R4-H1, hardened R5+R6).
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
 *
 * R6 hardening:
 * - `approvalToken` (the `escrowRef` epoch stamped by `doApprove`)
 *   pins the revert to the approval CYCLE — a dispute-resolver's
 *   restored APPROVED carries a fresh token and is never reverted
 *   by a stale gate.
 * - A FROZEN/COMPLETED intent is never cancelled even when the
 *   milestone reads APPROVED (defensive — dispute-owned rows belong
 *   to the resolve path).
 * - The leg set is re-listed AFTER the intent CAS; a leg that paid
 *   in between rolls the whole revert back (throw → atomic abort).
 * - A failed intent CAS throws too — the milestone must never move
 *   while its intent stays OPEN (nit 2).
 * - `revert_blocked` is logged at error level — the outcome is
 *   operator-visible, not just a best-effort event (R6-M5).
 */
import { logger } from "@agentbadge/passport/logger";

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
  /** R6-M2: approval-epoch token from `doApprove` — refuse when the
   *  row's `escrowRef` moved on to a different approval cycle. */
  approvalToken?: string;
}

/** R8-M2/R9-M2: closed union of refusal causes — callers whitelist the
 *  benign ones and default everything else to error+`repair`. Adding a
 *  new code without touching the classifier is fail-CLOSED (unknown
 *  codes error). */
export type RevertReason =
  | "not_approved"
  | "released"
  | "epoch_mismatch"
  | "intent_mismatch"
  | "intent_state"
  | "paid_leg";

export interface RevertResult {
  reverted: boolean;
  /** Why a refusal happened — callers log ERROR only for the dangerous
   *  codes (released/paid_leg/intent_state), not for a benign no-op
   *  like a sibling having already released the row. */
  reason?: RevertReason;
}

export async function revertApproval(
  ctx: SettlementCtx,
  milestoneRowId: string,
  actorWallet: string,
  opts: RevertOptions = {},
): Promise<SettlementResult<RevertResult>> {
  const buf = ctx.emit.buffer();
  const to = opts.release ? "PENDING" : "READY";
  let res: SettlementResult<RevertResult>;
  try {
    res = await ctx.db.settlement.atomic(async (s) => {
      const milestone = await s.milestones.getById(milestoneRowId);
      if (!milestone) {
        return fail("NOT_FOUND", `milestone not found: ${milestoneRowId}`);
      }
      // Idempotent — anything but APPROVED means the verdict path no
      // longer owns this row (already reverted, disputed, released).
      // R9-M2a: RELEASED is its own code — a payout landed under a
      // verdict that never committed; that is operator-visible damage,
      // not a benign no-op.
      if (milestone.status !== "APPROVED") {
        return ok({
          reverted: false,
          reason:
            milestone.status === "RELEASED" ? "released" : "not_approved",
        });
      }
      // R6-M2: the APPROVED on the row must be the one THIS request's
      // gate minted. A resolver-restored or re-landed approval carries
      // a different epoch — leave it (and its intent) untouched.
      if (
        opts.approvalToken !== undefined &&
        milestone.escrowRef !== opts.approvalToken
      ) {
        return ok({ reverted: false, reason: "epoch_mismatch" });
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
        return ok({ reverted: false, reason: "intent_mismatch" });
      }
      // R6 nit 3: only an OPEN intent is ours to cancel — CANCELLED is
      // already undone (milestone still moves back), anything else
      // (FROZEN = dispute-owned, COMPLETED = paid) means this approval
      // no longer belongs to a verdict path: refuse.
      if (intent && !["OPEN", "CANCELLED"].includes(intent.status)) {
        logger.error("approval revert refused — intent in unexpected state", {
          milestoneId: milestone.id,
          intentId: intent.id,
          intentStatus: intent.status,
        });
        return ok({ reverted: false, reason: "intent_state" });
      }
      if (intent && intent.status === "OPEN") {
        const legs = await s.payoutLegs.listByIntent(intent.id);
        // M-5: a paid leg means money already moved under this intent —
        // the approval must stand; operator review decides the rest.
        if (legs.some((l) => ["COMPLETED", "FAILED"].includes(l.status))) {
          logger.error("approval revert blocked — paid leg present", {
            milestoneId: milestone.id,
            intentId: intent.id,
          });
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
          return ok({ reverted: false, reason: "paid_leg" });
        }
      }
      const reverted = await s.milestones.applyStatus(
        milestone.id,
        "APPROVED",
        to,
        opts.release
          ? { submissionRef: null, escrowRef: null }
          : { escrowRef: null },
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
        // R6 nit 2: a lost intent CAS must roll the whole revert back —
        // a READY/PENDING milestone with a live OPEN intent strands an
        // authorization nothing else owns.
        if (!cancelled) {
          throw new SettlementConflictError(
            `payout intent ${intent.id} moved during revert — aborting`,
          );
        }
        // R6 nit 1: re-list AFTER the CAS — a mark-paid that committed
        // between the guard read and the CAS must abort the revert.
        const liveLegs = await s.payoutLegs.listByIntent(intent.id);
        if (liveLegs.some((l) => ["COMPLETED", "FAILED"].includes(l.status))) {
          throw new SettlementConflictError(
            `payout leg under intent ${intent.id} paid during revert — aborting`,
          );
        }
        for (const leg of liveLegs) {
          if (leg.status === "OPEN") {
            const cl = await s.payoutLegs.applyStatus(
              leg.id,
              "OPEN",
              "CANCELLED",
            );
            if (!cl) {
              throw new SettlementConflictError(
                `payout leg ${leg.id} moved during revert — aborting`,
              );
            }
            buf.emit({
              entityType: "payout_leg",
              entityId: leg.id,
              eventType: "leg.cancelled",
              actorWallet,
              payload: { intentId: intent.id },
            });
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
