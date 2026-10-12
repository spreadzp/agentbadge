/**
 * SLICE-197-09: bounty QA runner — timer wrapper.
 *
 * Core pipeline lives in `lib/bounties/qa.ts` (+ `qa-run.ts` for the
 * isolated subprocess layer). Each tick scans `submitted` bounties
 * without an outcome, verifies sha ∈ PR, runs build/test/lint in a
 * scrubbed subprocess env, records verdict → bounty_outcome +
 * submitted→passed|failed.
 *
 * Runs untrusted code → gated on BOUNTY_QA_RUNNER_ENABLED=true
 * (explicit opt-in; unlike the sweeper this is OFF by default).
 * Timer pattern mirrors escrow-reconciler: first tick +30s after
 * boot, interval ±30s jitter.
 */
import { logger } from "@agentbadge/passport";

import { qaSweep } from "../lib/bounties/qa";

export {
  evaluateBountyQa,
  qaSweep,
  recordQaVerdict,
  type QaDeps,
  type QaSweepResult,
  type QaVerdict,
} from "../lib/bounties/qa";
export { runnerEnv } from "../lib/bounties/qa-run";

// ─── Timer ───────────────────────────────────────────────────────

let runnerTimer: ReturnType<typeof setInterval> | null = null;
let inFlight = false;

const DEFAULT_INTERVAL_MS = 60 * 1000;
const JITTER_MS = 30_000;

export function startBountyQaRunner(opts?: { intervalMs?: number }): void {
  const enabled = process.env.BOUNTY_QA_RUNNER_ENABLED === "true";
  if (!enabled) {
    logger.info(
      "Bounty QA runner disabled (BOUNTY_QA_RUNNER_ENABLED!=true)",
    );
    return;
  }
  if (runnerTimer) {
    logger.warn("Bounty QA runner already running");
    return;
  }
  const baseInterval = opts?.intervalMs ?? DEFAULT_INTERVAL_MS;
  const tick = async () => {
    if (inFlight) return; // one evaluation pipeline at a time
    inFlight = true;
    try {
      const result = await qaSweep();
      if (result.evaluated > 0 || result.errors.length > 0) {
        logger.info("Bounty QA runner tick", {
          evaluated: result.evaluated,
          passed: result.passed,
          failed: result.failed,
          errors: result.errors.length,
        });
      }
    } catch (err) {
      logger.error("Bounty QA runner error", {
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      inFlight = false;
    }
    const jitter = Math.floor(Math.random() * JITTER_MS) - JITTER_MS / 2;
    runnerTimer = setTimeout(tick, baseInterval + jitter);
  };
  runnerTimer = setTimeout(tick, 30_000);
  logger.info("Bounty QA runner started", { intervalMs: baseInterval });
}

export function stopBountyQaRunner(): void {
  if (runnerTimer) {
    clearTimeout(runnerTimer);
    runnerTimer = null;
    logger.info("Bounty QA runner stopped");
  }
}
