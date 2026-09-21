// EPIC-140 (SLICE-140-14): market manage route handlers extracted from routes/market.ts.
// Handler implementations; routes/market.ts registers them against paths + describeRoute.
import type { Context } from "hono";
import { submitTaskMessage, prepareTransferTransaction, isValidA2ADid, didToAccountId, createScheduledTransfer, deleteScheduledTransaction } from "@agentbadge/hedera-core";
import { getTaskById, setEscrowStatus, updateTaskVerificationAttempts, logger, reserveTask, transitionTask } from "@agentbadge/passport";
import { ErrorCodes } from "./error-codes";
import { errorResponse } from "./error-response";
import { runVerification } from "../../verifiers";
import { assertSameActor } from "../middleware/did-auth";
import { toPublicError } from "./error-map";

export async function preparePayment(c: Context): Promise<Response> {
    let body: Record<string, unknown>;
    try {
      body = await c.req.json();
    } catch {
      return errorResponse(c, 400, ErrorCodes.INVALID_JSON, "Invalid JSON body");
    }

    const { posterDid } = body as { posterDid?: string };

    if (!posterDid) {
      return errorResponse(c, 400, ErrorCodes.MISSING_FIELDS, "Missing required field: posterDid");
    }

    if (!isValidA2ADid(posterDid)) {
      return errorResponse(c, 400, ErrorCodes.INVALID_DID_FORMAT, "Invalid posterDid format");
    }

    // Assert verified DID matches actor field (defense-in-depth)
    const actorMismatch = assertSameActor(c, posterDid);
    if (actorMismatch) return actorMismatch;

    const taskId = c.req.param("taskId")!;
    const task = getTaskById(taskId);

    if (!task) {
      return errorResponse(c, 404, ErrorCodes.TASK_NOT_FOUND, "Task not found");
    }

    if (task.posterDid !== posterDid) {
      return errorResponse(c, 403, ErrorCodes.PASSPORT_OWNERSHIP_MISMATCH, "Only the task poster can prepare payment");
    }

    if (task.status !== "delivered") {
      return errorResponse(c, 400, ErrorCodes.INVALID_JSON, `Task must be in delivered status, current: ${task.status}`);
    }

    if (!task.claimerDid) {
      return errorResponse(c, 400, ErrorCodes.MISSING_FIELDS, "Task has no claimer assigned");
    }

    try {
      const fromAccountId = await didToAccountId(posterDid);
      if (!fromAccountId) {
        return errorResponse(c, 400, ErrorCodes.INTERNAL_ERROR, "Could not resolve poster DID to account ID");
      }

      const toAccountId = await didToAccountId(task.claimerDid);
      if (!toAccountId) {
        return errorResponse(c, 400, ErrorCodes.INTERNAL_ERROR, "Could not resolve claimer DID to account ID");
      }

      const { txBytes, txId } = await prepareTransferTransaction(
        fromAccountId,
        toAccountId,
        task.priceHbar,
      );

      logger.info("Payment prepared", { taskId, txId, fromAccountId, toAccountId });

      return c.json(
        { txBytes, txId, fromAccountId, toAccountId, amountHbar: task.priceHbar },
        200,
      );
    } catch (err) {
      const pub = toPublicError(err);
      logger.error("Payment preparation failed", { error: err instanceof Error ? err.message : String(err), taskId });
      return errorResponse(c, 500, pub.code, pub.safeMessage, { retryable: true });
    }
}

export async function cancelTask(c: Context): Promise<Response> {
    let body: Record<string, unknown>;
    try {
      body = await c.req.json();
    } catch {
      return errorResponse(c, 400, ErrorCodes.INVALID_JSON, "Invalid JSON body");
    }

    const { posterDid } = body as { posterDid?: string };

    if (!posterDid) {
      return errorResponse(c, 400, ErrorCodes.MISSING_FIELDS, "Missing required field: posterDid");
    }

    if (!isValidA2ADid(posterDid)) {
      return errorResponse(c, 400, ErrorCodes.INVALID_DID_FORMAT, "Invalid posterDid format");
    }

    // Assert verified DID matches actor field (defense-in-depth)
    const actorMismatch = assertSameActor(c, posterDid);
    if (actorMismatch) return actorMismatch;

    const taskId = c.req.param("taskId")!;
    const task = getTaskById(taskId);

    if (!task) {
      return errorResponse(c, 404, ErrorCodes.TASK_NOT_FOUND, "Task not found");
    }

    if (task.posterDid !== posterDid) {
      return errorResponse(c, 403, ErrorCodes.PASSPORT_OWNERSHIP_MISMATCH, "Only the task poster can cancel this task");
    }

    if (!["posted", "claimed", "delivered"].includes(task.status)) {
      return errorResponse(c, 400, ErrorCodes.INVALID_JSON, `Task cannot be cancelled from status: ${task.status}`);
    }

    // SLICE-84-1: Atomic reservation before async escrow+HCS I/O
    const reservation = reserveTask(taskId, ["posted", "claimed", "delivered"], "cancelling");
    if (!reservation.ok) {
      return errorResponse(c, 409, ErrorCodes.INVALID_JSON, `Task is ${reservation.currentStatus}, cannot cancel`);
    }

    try {
      if (task.scheduleId) {
        try {
          await deleteScheduledTransaction(task.scheduleId);
          setEscrowStatus(taskId, "cancelled");
        } catch (cancelErr) {
          logger.error("Escrow cancellation failed during task cancel", { error: cancelErr instanceof Error ? cancelErr.message : "unknown", taskId });
        }
      }

      // SLICE-84-1: Commit from transitional to final state
      const committed = transitionTask(taskId, ["cancelling"], "cancelled");
      if (!committed.ok) {
        logger.error("Cancel commit failed — task state changed during I/O", { taskId, currentStatus: committed.currentStatus });
        return errorResponse(c, 409, ErrorCodes.INVALID_JSON, "Task state changed during cancel");
      }

      const timestamp = Math.floor(Date.now() / 1000);
      const message = {
        type: "task_cancelled" as const,
        taskId,
        scheduleId: task.scheduleId,
        timestamp,
      };

      const { txId: hcsTxId } = await submitTaskMessage(message);

      logger.info("Marketplace task cancelled", { hcsTxId, taskId });

      return c.json({ taskId, cancelledAt: timestamp, hbarReturned: task.scheduleId ? task.priceHbar : 0 }, 200);
    } catch (err) {
      // SLICE-84-1: Rollback to original status on failure
      transitionTask(taskId, ["cancelling"], task.status);
      const pub = toPublicError(err);
      logger.error("Marketplace task cancel failed", { error: err instanceof Error ? err.message : String(err), taskId });
      return errorResponse(c, 500, pub.code, pub.safeMessage, { retryable: true });
    }
}

export async function increaseReward(c: Context): Promise<Response> {
    let body: Record<string, unknown>;
    try {
      body = await c.req.json();
    } catch {
      return errorResponse(c, 400, ErrorCodes.INVALID_JSON, "Invalid JSON body");
    }

    const { posterDid, newPriceHbar } = body as {
      posterDid?: string;
      newPriceHbar?: number;
    };

    if (!posterDid) {
      return errorResponse(c, 400, ErrorCodes.MISSING_FIELDS, "Missing required field: posterDid");
    }

    if (!isValidA2ADid(posterDid)) {
      return errorResponse(c, 400, ErrorCodes.INVALID_DID_FORMAT, "Invalid posterDid format");
    }

    if (typeof newPriceHbar !== "number" || newPriceHbar <= 0) {
      return errorResponse(c, 400, ErrorCodes.MISSING_FIELDS, "Missing or invalid field: newPriceHbar");
    }

    // Assert verified DID matches actor field (defense-in-depth)
    const actorMismatch = assertSameActor(c, posterDid);
    if (actorMismatch) return actorMismatch;

    const taskId = c.req.param("taskId")!;
    const task = getTaskById(taskId);

    if (!task) {
      return errorResponse(c, 404, ErrorCodes.TASK_NOT_FOUND, "Task not found");
    }

    if (task.posterDid !== posterDid) {
      return errorResponse(c, 403, ErrorCodes.PASSPORT_OWNERSHIP_MISMATCH, "Only the task poster can increase reward");
    }

    if (!["posted", "claimed"].includes(task.status)) {
      return errorResponse(c, 400, ErrorCodes.INVALID_JSON, `Reward can only be increased for tasks in posted/claimed status, current: ${task.status}`);
    }

    if (newPriceHbar <= task.priceHbar) {
      return errorResponse(c, 400, ErrorCodes.INVALID_JSON, `newPriceHbar (${newPriceHbar}) must be greater than current price (${task.priceHbar})`);
    }

    // SLICE-84-1: Atomic reservation before async escrow+HCS I/O
    const originalStatus = task.status;
    const reservation = reserveTask(taskId, ["posted", "claimed"], "updating_reward");
    if (!reservation.ok) {
      return errorResponse(c, 409, ErrorCodes.INVALID_JSON, `Task is ${reservation.currentStatus}, cannot increase reward`);
    }

    try {
      const fromAccountId = await didToAccountId(posterDid);
      if (!fromAccountId) {
        // SLICE-84-1: Rollback on early return
        transitionTask(taskId, ["updating_reward"], originalStatus);
        return errorResponse(c, 400, ErrorCodes.INTERNAL_ERROR, "Could not resolve poster DID to account ID");
      }

      if (task.scheduleId) {
        try {
          await deleteScheduledTransaction(task.scheduleId);
        } catch (cancelErr) {
          logger.error("Old escrow deletion failed during increase-reward", { error: cancelErr instanceof Error ? cancelErr.message : "unknown", taskId });
        }
      }

      const { scheduleId: newScheduleId, scheduleTxId: newScheduleTxId } = await createScheduledTransfer(
        fromAccountId,
        task.claimerDid ?? "",
        newPriceHbar,
        { memo: `escrow:${taskId}:${newPriceHbar}` },
      );

      setEscrowStatus(taskId, "pending", {
        priceHbar: newPriceHbar,
        scheduleId: newScheduleId,
        scheduleTxId: newScheduleTxId,
      });

      const timestamp = Math.floor(Date.now() / 1000);
      const message = {
        type: "task_reward_increased" as const,
        taskId,
        oldPriceHbar: task.priceHbar,
        newPriceHbar,
        newScheduleId,
        timestamp,
      };

      const { txId: hcsTxId } = await submitTaskMessage(message);

      // SLICE-84-1: Commit back to original status with updated price
      const committed = transitionTask(taskId, ["updating_reward"], originalStatus, { priceHbar: newPriceHbar });
      if (!committed.ok) {
        logger.error("Increase-reward commit failed — task state changed during I/O", { taskId, currentStatus: committed.currentStatus });
        return errorResponse(c, 409, ErrorCodes.INVALID_JSON, "Task state changed during reward increase");
      }

      logger.info("Marketplace task reward increased", { hcsTxId, taskId, oldPrice: task.priceHbar, newPrice: newPriceHbar });

      return c.json({ taskId, newScheduleId, newPriceHbar, hcsTxId }, 200);
    } catch (err) {
      // SLICE-84-1: Rollback to original status on failure
      transitionTask(taskId, ["updating_reward"], originalStatus);
      const pub = toPublicError(err);
      logger.error("Marketplace reward increase failed", { error: err instanceof Error ? err.message : String(err), taskId });
      return errorResponse(c, 500, pub.code, pub.safeMessage, { retryable: true });
    }
}

export async function escrowStatus(c: Context): Promise<Response> {
    const taskId = c.req.param("taskId")!;
    const task = getTaskById(taskId);

    if (!task) {
      return errorResponse(c, 404, ErrorCodes.TASK_NOT_FOUND, "Task not found");
    }

    return c.json({
      taskId,
      scheduleId: task.scheduleId ?? null,
      escrowStatus: task.escrowStatus ?? "none",
      verificationAttempts: task.verificationAttempts ?? 0,
      verifierType: task.verifierType ?? "noop",
      priceHbar: task.priceHbar,
      // SLICE-84-2: Extended fields for reconciler observability
      transitionalSince: task.transitionalSince ?? null,
      lastError: task.lastError ?? null,
    }, 200);
}

export async function verifyTask(c: Context): Promise<Response> {
    const taskId = c.req.param("taskId")!;
    const task = getTaskById(taskId);

    if (!task) {
      return errorResponse(c, 404, ErrorCodes.TASK_NOT_FOUND, "Task not found");
    }

    if (!["delivered", "claimed"].includes(task.status)) {
      return errorResponse(c, 400, ErrorCodes.INVALID_JSON, `Verification requires delivered or claimed status, current: ${task.status}`);
    }

    try {
      const outcome = await runVerification(task);

      if (outcome.attempts !== undefined) {
        updateTaskVerificationAttempts(taskId, outcome.attempts);
      }

      logger.info("Marketplace task verification triggered", { taskId, passed: outcome.passed, attempts: outcome.attempts });

      return c.json({
        taskId,
        passed: outcome.passed,
        attempts: outcome.attempts,
        shouldReturnToMarket: outcome.shouldReturnToMarket,
        report: outcome.result?.report ?? null,
      }, 200);
    } catch (err) {
      const pub = toPublicError(err);
      logger.error("Marketplace verification failed", { error: err instanceof Error ? err.message : String(err), taskId });
      return errorResponse(c, 500, pub.code, pub.safeMessage, { retryable: true });
    }
}
