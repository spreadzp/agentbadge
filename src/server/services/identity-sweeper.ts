/**
 * EPIC-225 (audit round-3 F-4, round-4 N-2/N-7/N-10/N-11):
 * identity entitlement sweeper — timer wrapper over
 * `IdentityService.sweep()` (D-225-4 poll-based activation +
 * expiry + reversal revocation).
 *
 * Timer pattern mirrors bounty-lease-sweeper.ts: env gate
 * (IDENTITY_SWEEPER_ENABLED, default on), first tick +30s after
 * boot, setTimeout chain with ±15s jitter, errors logged not
 * thrown. The service instance is the shared singleton from
 * wiring/identity-service.ts — the same one the REST routes use,
 * so the rotating reversal cursor persists across ticks.
 *
 * Round-4 hardening:
 * - N-2: each tick races sweep() against a deadline — a hung RPC
 *   or DB read can no longer wedge the chain forever; reschedule
 *   happens in `finally` either way.
 * - N-7: `stopped` flag is checked before rescheduling, so an
 *   in-flight tick cannot resurrect the sweeper after stop().
 * - N-10: material ticks log durationMs + the first few error
 *   messages (result.errors is already capped at MAX_ERRORS), so
 *   a permanently failing feed is diagnosable, not just counted.
 * - N-11: gate accepts "false"/"0"/"off" (case-insensitive);
 *   interval is clamped to >=10s; timers are unref'd so test
 *   processes can exit.
 */
import { logger } from "@agentbadge/passport/logger";

import { getIdentityService } from "../wiring/identity-service";

let sweeperTimer: ReturnType<typeof setTimeout> | null = null;
let stopped = true;

const DEFAULT_INTERVAL_MS = 60_000;
const MIN_INTERVAL_MS = 10_000;
const JITTER_MS = 30_000;
const TICK_DEADLINE_MS = 5 * 60_000;

/** Values that disable the sweeper (N-11 — not just "false"). */
const DISABLED = new Set(["false", "0", "off", "no"]);

const schedule = (fn: () => void, ms: number) => {
  const t = setTimeout(fn, ms);
  if (typeof t === "object" && "unref" in t) t.unref();
  return t;
};

export function startIdentitySweeper(opts?: {
  intervalMs?: number;
}): void {
  const enabled = !DISABLED.has(
    (process.env.IDENTITY_SWEEPER_ENABLED ?? "").toLowerCase(),
  );
  if (!enabled) {
    logger.info("Identity sweeper disabled (IDENTITY_SWEEPER_ENABLED)");
    return;
  }
  if (sweeperTimer) {
    logger.warn("Identity sweeper already running");
    return;
  }
  stopped = false;
  const envMs = Number(process.env.IDENTITY_SWEEPER_INTERVAL_MS);
  const baseInterval = Math.max(
    MIN_INTERVAL_MS,
    opts?.intervalMs ??
      (Number.isFinite(envMs) && envMs > 0 ? envMs : DEFAULT_INTERVAL_MS),
  );

  const tick = async () => {
    const startedAt = Date.now();
    let deadline: ReturnType<typeof setTimeout> | null = null;
    try {
      // N-2: deadline race — a hung sweep() rejects the race, the
      // error is logged, and the chain still reschedules below.
      // The deadline timer is unref'd + cleared on settle: a
      // resolved sweep must not hold the process for 5 minutes.
      const result = await Promise.race([
        getIdentityService().sweep(),
        new Promise<never>((_, reject) => {
          deadline = setTimeout(
            () => reject(new Error("sweep tick deadline exceeded")),
            TICK_DEADLINE_MS,
          );
          if (typeof deadline === "object" && "unref" in deadline)
            deadline.unref();
        }),
      ]);
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
          durationMs: Date.now() - startedAt,
        });
        // N-10: surface the first few error messages — a standing
        // failure must be diagnosable from logs, not just counted.
        for (const e of result.errors.slice(0, 3)) {
          logger.warn("Identity sweeper item error", {
            stage: e.stage,
            error: e.message,
          });
        }
      }
    } catch (err) {
      logger.error("Identity sweeper error", {
        error: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - startedAt,
      });
    } finally {
      // Drop the (already-fired or still-pending) deadline timer —
      // a resolved sweep must not leave a 5-minute handle behind.
      if (deadline) clearTimeout(deadline);
      // N-7: never resurrect a stopped sweeper; reschedule always
      // (an exception above must not kill the chain — N-2).
      if (!stopped) {
        const jitter = Math.floor(Math.random() * JITTER_MS) - JITTER_MS / 2;
        sweeperTimer = schedule(tick, Math.max(1000, baseInterval + jitter));
      }
    }
  };
  // First tick +30s after boot (pattern: escrow-reconciler).
  sweeperTimer = schedule(tick, 30_000);
  logger.info("Identity sweeper started", { intervalMs: baseInterval });
}

export function stopIdentitySweeper(): void {
  stopped = true;
  if (sweeperTimer) {
    clearTimeout(sweeperTimer);
    sweeperTimer = null;
    logger.info("Identity sweeper stopped");
  }
}
