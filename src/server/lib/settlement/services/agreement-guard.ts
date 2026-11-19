/**
 * EPIC-227 / SLICE-227-8 — R11: the shared release/reopen agreement
 * guard. Releasing a milestone back to PENDING under a closed commerce
 * agreement orphans it: submission and review both require an ACTIVE
 * agreement, so the plan keeps dead work forever. Likewise a still-
 * SUBMITTED binding means a verdict (and its `appr_` gate) is in
 * flight — releasing or unbinding races it.
 *
 * Layering note: this is a data-layer read of `db.commerce` — no
 * commerce service import. The rule "settlement never imports
 * commerce" stays intact for domain logic; documented exception.
 */
import { logger } from "@agentbadge/passport/logger";

import { type SettlementResult, fail } from "../types.js";
import type { SettlementCtx } from "./ctx.js";

/**
 * Returns a refusal when the milestone must not move to PENDING:
 * - the plan's commerce agreement exists and is COMPLETED/CANCELLED
 *   (orphan — the operator's real exits are paying the OPEN intent or
 *   a participant-raised FOR_BUYER dispute), or
 * - the bound submission is still SUBMITTED (a verdict + gate approve
 *   are in flight — let it land first).
 * A MISSING agreement row is a pure-settlement plan — the only
 * intentional fail-open branch. A failed read fails CLOSED.
 */
export async function checkReleasableAgreement(
  ctx: SettlementCtx,
  plan: { id: string; agreementRef: string },
  milestone: { id: string; submissionRef?: string | null },
): Promise<SettlementResult<never> | null> {
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
    return fail(
      "PROVIDER_ERROR",
      "cannot verify commerce agreement state — release refused",
    );
  }
  if (agreement && ["COMPLETED", "CANCELLED"].includes(agreement.status)) {
    // R11 nit 3: only terminal commerce states orphan — a DISPUTED or
    // otherwise live agreement still accepts submissions/reviews.
    return fail(
      "INVALID_STATE",
      `commerce agreement is ${agreement.status} — releasing would orphan the milestone; pay the OPEN intent, or the buyer/provider raises a dispute resolved FOR_BUYER`,
      { reason: "agreement_not_active", agreementStatus: agreement.status },
    );
  }
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
      return fail(
        "PROVIDER_ERROR",
        "cannot verify bound submission state — release refused",
      );
    }
    if (submission && submission.status === "SUBMITTED") {
      return fail(
        "INVALID_STATE",
        "bound submission is still SUBMITTED — a verdict/gate is in flight; let it commit first",
        { reason: "gate_in_flight" },
      );
    }
  }
  return null;
}
