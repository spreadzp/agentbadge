/**
 * EPIC-225 (audit round-3 F-4): identity entitlement sweeper —
 * timer wrapper over `IdentityService.sweep()` (D-225-4 poll-based
 * activation + expiry + reversal revocation).
 *
 * Timer pattern mirrors bounty-lease-sweeper.ts: env gate
 * (IDENTITY_SWEEPER_ENABLED, default on), first tick +30s after
 * boot, setTimeout chain with ±30s jitter, errors logged not
 * thrown. The service instance is the shared singleton from
 * wiring/identity-service.ts — the same one the REST routes use,
 * so the rotating reversal cursor persists across ticks.
 */
import { logger } from "@agentbadge/passport/logger";

import { getIdentityService } from "../wiring/identity-service";

let sweeperTimer: ReturnType<typeof setTimeout> | null = null;

const DEFAULT_INTERVAL_MS = 60_000;
const JITTER_MS = 30_000;

export function startIdentitySweeper(opts?: {
  intervalMs?: number;
}): void {
  const enabled = process.env.IDENTITY_SWEEPER_ENABLED !== "false";
  if (!enabled) {
    logger.info("Identity sweeper disabled (IDENTITY_SWEEPER_ENABLED=false)");
    return;
  }
  if (sweeperTimer) {
    logger.warn("Identity sweeper already running");
    return;
  }
  const baseInterval =
    opts?.intervalMs ??
    (Number(process.env.IDENTITY_SWEEPER_INTERVAL_MS) || DEFAULT_INTERVAL_MS);
  const tick = async () => {
    try {
      const result = await getIdentityService().sweep();
      if (
        result.granted > 0 ||
        result.expired > 0 ||
        result.revoked > 0 ||
        result.reactivated > 0 ||
        result.errorsCount > 0
      ) {
        logger.info("Identity sweeper tick", {
          attemptsScanned: result.attemptsScanned,
          candidates: result.candidates,
          granted: result.granted,
          deduped: result.deduped,
          expired: result.expired,
          revoked: result.revoked,
          reactivated: result.reactivated,
          errors: result.errorsCount,
        });
      }
    } catch (err) {
      logger.error("Identity sweeper error", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
    const jitter = Math.floor(Math.random() * JITTER_MS) - JITTER_MS / 2;
    sweeperTimer = setTimeout(tick, Math.max(1000, baseInterval + jitter));
  };
  // First tick +30s after boot (pattern: escrow-reconciler).
  sweeperTimer = setTimeout(tick, 30_000);
  logger.info("Identity sweeper started", { intervalMs: baseInterval });
}

export function stopIdentitySweeper(): void {
  if (sweeperTimer) {
    clearTimeout(sweeperTimer);
    sweeperTimer = null;
    logger.info("Identity sweeper stopped");
  }
}
