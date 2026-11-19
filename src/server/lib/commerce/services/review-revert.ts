/**
 * SLICE-227-8 — the verdict-failure compensation, extracted under the
 * 300-line cap. Revert the review gate's own pre-commit approve when
 * the verdict atomic failed (R4-H1), self-heal the sibling-committed
 * window, and keep every abort/refusal operator-visible (`repair`).
 */
import { logger } from "@agentbadge/passport/logger";
import type { CommerceCtx } from "./ctx";
import type { SettlementGate } from "./review-settlement";

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
      // R8-M2: `null` = the bridge swallowed a conflict/fail — the
      // abort R7-M4 listed; it still leaves APPROVED + OPEN stranded.
      if (res === null) {
        logger.error("approval revert aborted — bridge returned null", {
          repair: "review milestone approval",
          milestoneRowId: settleMilestoneId,
          submissionId,
          intentId: gate.intentId,
        });
      } else if (!res.reverted) {
        // R8-M2: `reverted:false` is overloaded — paid_leg and an
        // unexpected intent state are the dangerous causes; a moved
        // milestone or stale epoch/intent pin is a benign no-op (a
        // sibling already released it, or the dispute owns it now).
        if (res.reason === "paid_leg" || res.reason === "intent_state") {
          logger.error("approval revert refused — approval stands", {
            repair: "review milestone approval",
            milestoneRowId: settleMilestoneId,
            submissionId,
            intentId: gate.intentId,
            reason: res.reason,
          });
        } else {
          logger.warn("approval revert declined — approval cycle moved on", {
            milestoneRowId: settleMilestoneId,
            submissionId,
            intentId: gate.intentId,
            reason: res.reason,
          });
        }
      }
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
