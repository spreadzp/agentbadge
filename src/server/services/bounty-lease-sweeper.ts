/**
 * SLICE-197-07: bounty lease sweeper — timer wrapper.
 *
 * Core sweep logic lives in `lib/bounties/sweep.ts`
 * (expired lease → onchain reject → reopen on new job, Q38-A).
 *
 * Timer pattern mirrors escrow-reconciler.ts: BOUNTY_SWEEPER_ENABLED
 * env gate, first tick +30s after boot, interval ±30s jitter.
 */
import { logger } from "@agentbadge/passport";

import { sweepBountyLeases } from "../lib/bounties/sweep";
import { sweepBoardClaimLeases } from "../lib/board/claim-sweep";
import { sweepBoardFixLoop } from "../lib/board/bug-sweep";
import { boardStore } from "../lib/board/store";

export {
  sweepBountyLeases,
  type BountySweepResult,
  type SweepDeps,
} from "../lib/bounties/sweep";

// ─── Timer ───────────────────────────────────────────────────────

let sweeperTimer: ReturnType<typeof setInterval> | null = null;

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;
const JITTER_MS = 30_000;

export function startBountyLeaseSweeper(opts?: {
  intervalMs?: number;
}): void {
  const enabled = process.env.BOUNTY_SWEEPER_ENABLED !== "false";
  if (!enabled) {
    logger.info("Bounty lease sweeper disabled (BOUNTY_SWEEPER_ENABLED=false)");
    return;
  }
  if (sweeperTimer) {
    logger.warn("Bounty lease sweeper already running");
    return;
  }
  const baseInterval =
    opts?.intervalMs ??
    (Number(process.env.BOUNTY_SWEEPER_INTERVAL_MS) || DEFAULT_INTERVAL_MS);
  const tick = async () => {
    try {
      // 199-13 D-199-7: board paths run first, sequentially — the
      // generic sweep's inline Circle-ABI reject leg would revert on
      // the ref deploy. Board claims expire through the outbox instead.
      const board = await sweepBoardClaimLeases().catch((e) => {
        logger.error("Board claim sweep error", {
          error: e instanceof Error ? e.message : String(e),
        });
        return null;
      });
      const fixes = await sweepBoardFixLoop().catch((e) => {
        logger.error("Board fix sweep error", {
          error: e instanceof Error ? e.message : String(e),
        });
        return null;
      });
      if (board && (board.expired > 0 || board.errors.length > 0)) {
        logger.info("Board claim sweeper tick", {
          expired: board.expired,
          reopened: board.reopened,
          cancelled: board.cancelled,
          errors: board.errors.length,
        });
      }
      if (fixes && fixes.swept.length > 0) {
        logger.info("Board fix sweeper tick", { swept: fixes.swept.length });
      }
      const st = boardStore();
      const result = await sweepBountyLeases({
        skipClaim: (claim) =>
          !!st.getCardByBounty(claim.bountyId),
      });
      if (result.expired > 0 || result.errors.length > 0) {
        logger.info("Bounty lease sweeper tick", {
          expired: result.expired,
          reopened: result.reopened,
          errors: result.errors.length,
        });
      }
    } catch (err) {
      logger.error("Bounty lease sweeper error", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
    const jitter = Math.floor(Math.random() * JITTER_MS) - JITTER_MS / 2;
    // Jitter can exceed a short env interval → negative delay clamps to
    // 1ms and spins; floor at 1s.
    sweeperTimer = setTimeout(tick, Math.max(1000, baseInterval + jitter));
  };
  // First tick +30s after boot (pattern: escrow-reconciler).
  sweeperTimer = setTimeout(tick, 30_000);
  logger.info("Bounty lease sweeper started", { intervalMs: baseInterval });
}

export function stopBountyLeaseSweeper(): void {
  if (sweeperTimer) {
    clearTimeout(sweeperTimer);
    sweeperTimer = null;
    logger.info("Bounty lease sweeper stopped");
  }
}
