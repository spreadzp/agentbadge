/**
 * SLICE-84-1: Shared transition wrapper — reserve→act→commit/rollback.
 *
 * Encapsulates the CAS pattern so handlers shrink to declarative configs.
 */

import { reserveTask, transitionTask, type TransitionResult } from "@agentbadge/passport";
import type { CachedMarketTask } from "@agentbadge/hedera-core";
import { ErrorCodes, type ErrorCode } from "./error-codes";
import { errorResponse } from "./error-response";
import type { Context } from "hono";

type TaskStatus = CachedMarketTask["status"];

export interface WithTransitionOptions {
  taskId: string;
  from: TaskStatus[];
  transitional: TaskStatus;
  final: TaskStatus;
  rollback: TaskStatus;
  rollbackPatch?: Partial<CachedMarketTask>;
  commitPatch?: Partial<CachedMarketTask>;
  errorCode?: ErrorCode;
  errorMessage?: string;
}

export interface WithTransitionResult {
  ok: boolean;
  response?: ReturnType<typeof errorResponse>;
  commitResult?: TransitionResult;
}

/**
 * Reserves a task into a transitional state, runs async work, then commits to final.
 * On any failure, rolls back to the rollback state.
 *
 * Usage:
 * ```ts
 * const result = await withTransition(c, {
 *   taskId,
 *   from: ["posted"],
 *   transitional: "claiming",
 *   final: "claimed",
 *   rollback: "posted",
 *   rollbackPatch: { claimerDid: undefined },
 *   commitPatch: { claimerDid, claimTxId: txId },
 * }, async () => {
 *   const txId = await submitTaskMessage(message);
 *   return { commitPatch: { claimerDid, claimTxId: txId } };
 * });
 * ```
 */
export async function withTransition<T extends { commitPatch?: Record<string, unknown> }>(
  c: Context,
  opts: WithTransitionOptions,
  work: () => Promise<T>,
): Promise<{ ok: true; data: T } | { ok: false; response: ReturnType<typeof errorResponse> }> {
  const reservation = reserveTask(opts.taskId, opts.from, opts.transitional);
  if (!reservation.ok) {
    return {
      ok: false,
      response: errorResponse(
        c,
        409,
        opts.errorCode ?? ErrorCodes.TASK_ALREADY_CLAIMED,
        opts.errorMessage ?? `Task is ${reservation.currentStatus}, cannot proceed`,
      ),
    };
  }

  try {
    const data = await work();

    const committed = transitionTask(
      opts.taskId,
      [opts.transitional],
      opts.final,
      { ...opts.commitPatch, ...data.commitPatch },
    );
    if (!committed.ok) {
      return {
        ok: false,
        response: errorResponse(
          c,
          409,
          opts.errorCode ?? ErrorCodes.TASK_ALREADY_CLAIMED,
          "Task state changed during operation",
        ),
      };
    }

    return { ok: true, data };
  } catch (err) {
    // Rollback reservation
    transitionTask(opts.taskId, [opts.transitional], opts.rollback, opts.rollbackPatch);
    throw err;
  }
}
