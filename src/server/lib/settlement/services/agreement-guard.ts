/**
 * EPIC-227 / SLICE-227-8 — R11/R12: the shared release/reopen agreement
 * guard. Releasing a milestone back to PENDING under a closed commerce
 * agreement orphans it: submission and review require a live agreement,
 * so the plan keeps dead work forever — the caller therefore CANCELS
 * instead of releasing (terminal, not an orphan). A still-SUBMITTED
 * binding means a verdict (and its `appr_` gate) is in flight —
 * releasing or unbinding races it.
 *
 * Layering note: this is a data-layer read of `db.commerce` — no
 * commerce service import. The rule "settlement never imports
 * commerce" stays intact for domain logic; documented exception.
 */
import { logger } from "@agentbadge/passport/logger";

import { type SettlementResult, fail } from "../types.js";
import type { SettlementCtx } from "./ctx.js";

/** What the caller may do with the milestone. */
export type GuardVerdict =
  /** Agreement live / absent — normal release path. R15-N2:
   *  `ackOverrode` marks that the caller's acknowledgeInFlight flag
   *  actually overrode a live in-flight gate — the post-check keys on
   *  this, not on the flag alone (a bound ACCEPTED row with no gate
   *  is the deliberate un-accept, not a landed verdict). */
  | { kind: "proceed"; ackOverrode?: boolean }
  /** Agreement terminal — PENDING would orphan; the caller takes the
   *  terminal CANCELLED path instead (R12-M1). R13-M2: the status is
   *  carried so the caller can distinguish CANCELLED (auto-cancel —
   *  nothing owed under a torn-down agreement) from COMPLETED (an
   *  APPROVED row there is usually an owed payout — cancel needs an
   *  explicit operator opt-in). R14-M2: `submissionStatus` lets the
   *  reopen path tell dead work from a stranded-READY owed
   *  entitlement (ACCEPTED submission). */
  | { kind: "cancel"; agreementStatus: string; submissionStatus?: string }
  /** Hard refusal — carries the SettlementResult to return. */
  | { kind: "refuse"; result: SettlementResult<never> };

/**
 * Decides whether the milestone may move:
 * - bound submission SUBMITTED + owned by THIS agreement/milestone +
 *   a commerce `appr_` epoch → a verdict is in flight → refuse
 *   `gate_in_flight` (R12-H1: a foreign binding or an `ops_`/`rsv_`
 *   epoch is NOT a gate — release unbinds it, never locks the exit);
 * - agreement COMPLETED/CANCELLED → `cancel` (terminal cleanup);
 * - agreement read throws → `PROVIDER_ERROR` (fail closed);
 * - a MISSING agreement row is a pure-settlement plan — the only
 *   intentional fail-open branch.
 */
export async function checkReleasableAgreement(
  ctx: SettlementCtx,
  plan: { id: string; agreementRef: string },
  milestone: {
    id: string;
    milestoneId: string;
    submissionRef?: string | null;
    escrowRef?: string | null;
  },
  opts?: {
    /** R13-M3: audited operator override for the in-flight gate — a
     *  dormant owned SUBMITTED row (buyer approved directly, verdict
     *  never came) would otherwise lock the exit indefinitely. */
    acknowledgeInFlight?: boolean;
  },
): Promise<GuardVerdict> {
  // R12 nit 9: read the submission FIRST — a completion landing between
  // the two reads then hits the harmless order (a SUBMITTED read
  // refuses before the stale agreement row can pass). The refusal is
  // only APPLIED after the agreement read: under a terminal agreement
  // no verdict is in flight anymore, so `cancel` must win or the exit
  // deadlocks on a stale SUBMITTED row.
  let inFlight = false;
  let submissionStatus: string | undefined;
  if (milestone.submissionRef) {
    let submission;
    try {
      submission = await ctx.db.commerce.submissions.getById(
        milestone.submissionRef,
      );
    } catch (err) {
      logger.error("submission state read failed — refusing release", {
        repair: "milestone agreement guard",
        submissionId: milestone.submissionRef,
        milestoneId: milestone.id,
        error: err instanceof Error ? err.message : String(err),
      });
      return {
        kind: "refuse",
        result: fail(
          "PROVIDER_ERROR",
          "cannot verify bound submission state — release refused",
        ),
      };
    }
    // R15-N1: one ownership predicate for BOTH the status carry and
    // the in-flight gate — an agreementId-only match let a foreign
    // ACCEPTED row over-refuse reopen with the wrong (force-approve)
    // exit. Legitimate bindings always satisfy both keys.
    const owned =
      !!submission &&
      submission.agreementId === plan.agreementRef &&
      submission.milestoneRef === milestone.milestoneId;
    if (owned) submissionStatus = submission!.status;
    inFlight =
      owned &&
      submission!.status === "SUBMITTED" &&
      milestone.escrowRef?.startsWith("appr_") === true;
  }
  let agreement;
  try {
    // R11-M1: no `.catch(() => null)` — a thrown read error (statement
    // timeout, pool exhaustion) must refuse, not proceed. The null ROW
    // is the pure-settlement case; a thrown ERROR is not.
    agreement = await ctx.db.commerce.agreements.getById(
      plan.agreementRef,
    );
  } catch (err) {
    logger.error("agreement state read failed — refusing release", {
      repair: "milestone agreement guard",
      agreementRef: plan.agreementRef,
      milestoneId: milestone.id,
      error: err instanceof Error ? err.message : String(err),
    });
    return {
      kind: "refuse",
      result: fail(
        "PROVIDER_ERROR",
        "cannot verify commerce agreement state — release refused",
      ),
    };
  }
  if (agreement && ["COMPLETED", "CANCELLED"].includes(agreement.status)) {
    // R11 nit 3 + R12-M1: only terminal commerce states orphan — a
    // DISPUTED or otherwise live agreement still accepts verdicts.
    // Terminal is not a refusal: the caller cancels the leftover work
    // (COMPLETED additionally needs the operator's confirmCancel —
    // see milestone-release.ts).
    return {
      kind: "cancel",
      agreementStatus: agreement.status,
      submissionStatus,
    };
  }
  if (inFlight && opts?.acknowledgeInFlight !== true) {
    return {
      kind: "refuse",
      result: fail(
        "INVALID_STATE",
        "bound submission is still SUBMITTED — a verdict/gate is in flight; let it commit first",
        { reason: "gate_in_flight" },
      ),
    };
  }
  return { kind: "proceed", ackOverrode: inFlight };
}
