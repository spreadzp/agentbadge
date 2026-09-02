/**
 * SLICE-84-2: Escrow Reconciler & Failure Events
 *
 * Background sweeper that finds orphaned scheduled transactions
 * and reclaims them. Config-gated via ESCROW_RECONCILER_ENABLED.
 */

import { listTasks, setEscrowStatus } from "@agentgate-hedera/passport";
import { deleteScheduledTransaction, submitTaskMessage } from "@agentgate-hedera/hedera-core";
import type { TaskMessage } from "@agentgate-hedera/hedera-core";
import { logger } from "@agentgate-hedera/passport";

export interface SweepResult {
  reclaimed: number;
  skipped?: boolean;
  errors: string[];
}

/**
 * Sweep all tasks for orphaned scheduleIds.
 * An orphan is a task with a scheduleId but escrowStatus not in {pending, released, reclaimed}
 * OR a task in "posted" status with a lingering scheduleId.
 */
export async function sweepEscrows(): Promise<SweepResult> {
  const enabled = process.env.ESCROW_RECONCILER_ENABLED !== "false";
  if (!enabled) {
    return { reclaimed: 0, skipped: true, errors: [] };
  }

  const result: SweepResult = { reclaimed: 0, errors: [] };
  const { tasks } = listTasks({ limit: 1000 });

  for (const task of tasks) {
    // Skip tasks without scheduleId
    if (!task.scheduleId) continue;

    // Skip tasks with healthy escrow states
    if (task.escrowStatus === "released" || task.escrowStatus === "cancelled" || task.escrowStatus === "reclaimed") {
      continue;
    }

    // Orphan condition: task is back to posted but scheduleId remains
    if (task.status === "posted" && task.escrowStatus === "pending") {
      try {
        await deleteScheduledTransaction(task.scheduleId);
        setEscrowStatus(task.taskId, "reclaimed", { lastError: "Reclaimed by sweeper" });
        result.reclaimed++;

        // Emit HCS note about reclamation
        try {
          await submitTaskMessage({
            type: "task_escrow_failed" as TaskMessage["type"],
            taskId: task.taskId,
            reason: "Scheduled transaction reclaimed by sweeper (orphaned after revert)",
            timestamp: Math.floor(Date.now() / 1000),
          } as TaskMessage);
        } catch (hcsErr) {
          logger.warn("Sweeper: failed to emit reclamation HCS message", {
            taskId: task.taskId,
            error: hcsErr instanceof Error ? hcsErr.message : String(hcsErr),
          });
        }

        logger.info("Sweeper reclaimed orphaned schedule", {
          taskId: task.taskId,
          scheduleId: task.scheduleId,
        });
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        result.errors.push(`${task.taskId}: ${errMsg}`);
        logger.error("Sweeper failed to reclaim schedule", {
          taskId: task.taskId,
          scheduleId: task.scheduleId,
          error: errMsg,
        });
      }
    }
  }

  return result;
}

let sweeperTimer: ReturnType<typeof setInterval> | null = null;

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const JITTER_MS = 30_000; // ±30 seconds jitter

/**
 * Start the background sweeper. Config-gated.
 */
export function startEscrowReconciler(opts?: { intervalMs?: number }): void {
  const enabled = process.env.ESCROW_RECONCILER_ENABLED !== "false";
  if (!enabled) {
    logger.info("Escrow reconciler disabled by config (ESCROW_RECONCILER_ENABLED=false)");
    return;
  }

  if (sweeperTimer) {
    logger.warn("Escrow reconciler already running");
    return;
  }

  const baseInterval = opts?.intervalMs ?? DEFAULT_INTERVAL_MS;

  const tick = async () => {
    try {
      const result = await sweepEscrows();
      if (result.reclaimed > 0 || result.errors.length > 0) {
        logger.info("Escrow sweeper completed", {
          reclaimed: result.reclaimed,
          errors: result.errors.length,
        });
      }
    } catch (err) {
      logger.error("Escrow sweeper error", { error: err instanceof Error ? err.message : String(err) });
    }

    // Schedule next tick with jitter
    const jitter = Math.floor(Math.random() * JITTER_MS) - JITTER_MS / 2;
    sweeperTimer = setTimeout(tick, baseInterval + jitter);
  };

  // Start after initial delay (30s after boot)
  sweeperTimer = setTimeout(tick, 30_000);
  logger.info("Escrow reconciler started", { intervalMs: baseInterval });
}

/**
 * Stop the background sweeper.
 */
export function stopEscrowReconciler(): void {
  if (sweeperTimer) {
    clearTimeout(sweeperTimer);
    sweeperTimer = null;
    logger.info("Escrow reconciler stopped");
  }
}
