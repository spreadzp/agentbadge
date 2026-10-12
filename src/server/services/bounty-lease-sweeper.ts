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
  const baseInterval = opts?.intervalMs ?? DEFAULT_INTERVAL_MS;
  const tick = async () => {
    try {
      const result = await sweepBountyLeases();
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
    sweeperTimer = setTimeout(tick, baseInterval + jitter);
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
