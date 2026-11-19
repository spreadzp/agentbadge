/**
 * SLICE-227-8 — the verdict-failure compensation, extracted under the
 * 300-line cap. Revert the review gate's own pre-commit approve when
 * the verdict atomic failed (R4-H1), self-heal the sibling-committed
 * window, and keep every abort/refusal operator-visible (`repair`).
 */
import { logger } from "@agentbadge/passport/logger";
import type { RevertReason } from "../../settlement/index.js";
import type { CommerceCtx } from "./ctx";
import type { SettlementGate } from "./review-settlement";

/** Bridge-shaped revert outcome — null on abort (the bridge maps any
 *  `!res.ok` to null after `settled()` logs it). */
export type BridgeRevertResult = {
  reverted: boolean;
  reason?: RevertReason;
} | null;

/** R9-M2b: the BENIGN whitelist — the approval cycle already moved on
 *  to another owner (a sibling released it, the resolver owns the row,
 *  the intent slot belongs to a different cycle). Every other code —
 *  `released`, `paid_leg`, `intent_state`, and anything added later —
 *  is dangerous and errors; the default is fail-closed. */
const BENIGN_REVERT_REASONS: ReadonlySet<RevertReason> = new Set([
  "not_approved",
  "epoch_mismatch",
  "intent_mismatch",
]);

/**
 * R8-M2/R9-M2 — the single revert-outcome classifier shared by every
 * caller (gate revert + reject-release). null abort and dangerous
 * refusal reasons log ERROR with a stable `repair` key; benign no-ops
 * log a plain warn so `repair` stays actionable.
 */
export function logRevertOutcome(
  label: string,
  res: BridgeRevertResult,
  fields: Record<string, unknown>,
): void {
  if (res === null) {
    logger.error(`${label} — aborted (bridge returned null)`, {
      repair: "review milestone approval",
      ...fields,
    });
    return;
  }
  if (res.reverted) return;
  if (res.reason !== undefined && BENIGN_REVERT_REASONS.has(res.reason)) {
    logger.warn(`${label} — approval cycle moved on`, {
      reason: res.reason,
      ...fields,
    });
    return;
  }
  logger.error(`${label} — approval stands`, {
    repair: "review milestone approval",
    reason: res.reason ?? "unknown",
    ...fields,
  });
}

/**
 * R4-H1 + R5-H2 + R6-M2 + R7-M4 — undo THIS gate's own pre-commit
 * approve when the verdict atomic failed. Only our approve reverts —
 * a sibling review's APPROVED belongs to its committed verdict.
 * Re-reads the submission first: ACCEPTED → skip (approval belongs to
 * that verdict); REJECTED/REVISION_REQUIRED → release straight to
 * PENDING; SUBMITTED → revert to READY. A FAILED re-read is UNKNOWN,
 * not "not committed" — fail closed and skip (a lost-ack verdict
 * looks identical). After a landed revert, one more re-read heals
 * the sibling-committed-in-the-gap case. `repair` is a stable
 * error-log key — every refused/aborted/ambiguous path is
 * operator-visible.
 */
export async function revertGateApproval(
  ctx: CommerceCtx,
  actor: string,
  submissionId: string,
  gate: SettlementGate,
): Promise<void> {
  const { stores } = ctx;
  if (
    gate.approvedByUs !== true ||
    !ctx.settlement ||
    gate.milestoneRowId === undefined
  ) {
    return;
  }
  const settleMilestoneId = gate.milestoneRowId;
  // R9 nit 2: fail closed on a missing epoch — `approvedByUs` without
  // the token means the pin inside revertApproval is silently off and
  // could undo an `rsv_`/`ops_` approval. Never run unpinned.
  if (!gate.approvalToken) {
    logger.error("approval revert skipped — gate has no epoch token", {
      repair: "review milestone approval",
      milestoneRowId: settleMilestoneId,
      submissionId,
      intentId: gate.intentId,
    });
    return;
  }
  try {
    const sub = await stores.submissions
      .getById(submissionId)
      .catch(() => null);
    if (!sub) {
      logger.error("approval revert skipped — submission re-read failed", {
        repair: "review milestone approval",
        milestoneRowId: settleMilestoneId,
        submissionId,
      });
    } else if (sub.status === "ACCEPTED") {
      // Sibling ACCEPT committed — approval belongs to that verdict.
    } else if (
      sub.status === "SUBMITTED" ||
      sub.status === "REJECTED" ||
      sub.status === "REVISION_REQUIRED"
    ) {
      const res = await ctx.settlement.revertApproval(
        settleMilestoneId,
        actor,
        {
          intentId: gate.intentId,
          approvalToken: gate.approvalToken,
          release:
            sub.status === "REJECTED" ||
            sub.status === "REVISION_REQUIRED",
        },
      );
      logRevertOutcome("approval revert", res, {
        milestoneRowId: settleMilestoneId,
        submissionId,
        intentId: gate.intentId,
      });
      if (res?.reverted) {
        const after = await stores.submissions
          .getById(submissionId)
          .catch(() => null);
        if (after?.status === "ACCEPTED") {
          const heal = await ctx.settlement
            .approveMilestone(settleMilestoneId, actor)
            .catch(() => null);
          if (heal?.ok) {
            logger.warn(
              "verdict committed during revert — approval healed",
              { milestoneRowId: settleMilestoneId, submissionId },
            );
          } else {
            logger.error(
              "settlement repair needed — ACCEPTED verdict has no payable intent",
              {
                repair: "re-approve milestone",
                milestoneRowId: settleMilestoneId,
                submissionId,
                code: heal?.error?.code,
                message: heal?.error?.message,
              },
            );
          }
        }
      }
    } else {
      logger.error("approval revert skipped — unexpected status", {
        repair: "review milestone approval",
        milestoneRowId: settleMilestoneId,
        submissionId,
        status: sub.status,
      });
    }
  } catch (revertErr) {
    logger.error("settlement approval revert failed", {
      repair: "review milestone approval",
      milestoneRowId: settleMilestoneId,
      error:
        revertErr instanceof Error ? revertErr.message : String(revertErr),
    });
  }
}
