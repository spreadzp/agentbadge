// EPIC-140 (SLICE-140-14): market lifecycle route handlers extracted from routes/market.ts.
// Handler implementations; routes/market.ts registers them against paths + describeRoute.
import type { Context } from "hono";
import { submitTaskMessage, transferHbarWithKey, transferHbarWithSignature, isValidA2ADid, didToAccountId, createScheduledTransfer, signScheduledTransaction, signScheduledTransactionWithSignature, deleteScheduledTransaction, getScheduleInfo } from "@agentbadge/hedera-core";
import { marketUpsert as upsert, listTasks, marketGet as get, getTaskById, setEscrowStatus, returnTaskToMarket, updateTaskVerificationAttempts, validatePagination, logger, reserveTask, transitionTask } from "@agentbadge/passport";
import { ErrorCodes } from "./error-codes";
import { errorResponse } from "./error-response";
import { taskLinks } from "./hateoas";
import { runVerification } from "../../verifiers";
import { assertSameActor } from "../middleware/did-auth";
import { toPublicError } from "./error-map";
import { checkPassportType, checkSessionCap, parseSignatureB64 } from "./market-auth";

export async function postTask(c: Context): Promise<Response> {
    let body: Record<string, unknown>;
    try {
      body = await c.req.json();
    } catch {
      return errorResponse(c, 400, ErrorCodes.INVALID_JSON, "Invalid JSON body");
    }

    const { posterDid, title, description, priceHbar, capabilities, deadline } = body as {
      posterDid?: string;
      title?: string;
      description?: string;
      priceHbar?: number;
      capabilities?: string[];
      deadline?: number;
    };

    if (!posterDid || !title || !description || priceHbar === undefined || !capabilities) {
      return errorResponse(c, 400, ErrorCodes.MISSING_FIELDS, "Missing required fields: posterDid, title, description, priceHbar, capabilities");
    }

    if (!isValidA2ADid(posterDid)) {
      return errorResponse(c, 400, ErrorCodes.INVALID_DID_FORMAT, "Invalid posterDid format");
    }

    if (!Array.isArray(capabilities) || capabilities.length === 0) {
      return errorResponse(c, 400, ErrorCodes.INVALID_CAPABILITIES, "capabilities must be a non-empty array");
    }

    if (typeof priceHbar !== "number" || priceHbar <= 0) {
      return errorResponse(c, 400, ErrorCodes.INVALID_PRICE, "priceHbar must be a positive number");
    }

    // Assert verified DID matches actor field (defense-in-depth)
    const actorMismatch = assertSameActor(c, posterDid);
    if (actorMismatch) return actorMismatch;

    // SLICE-90-12: Require CREATOR passport type for Base Sepolia DIDs
    const typeCheck = await checkPassportType(posterDid, "CREATOR");
    if (typeCheck) return typeCheck;

    try {
      const timestamp = Math.floor(Date.now() / 1000);
      const taskId = `task-${timestamp}-${Math.random().toString(36).slice(2, 8)}`;

      const message = {
        type: "task_posted" as const,
        taskId,
        posterDid,
        title,
        description,
        priceHbar,
        capabilities,
        deadline,
        timestamp,
      };

      const fullMessage = JSON.stringify(message);
      if (Buffer.byteLength(fullMessage, "utf8") > 4096) {
        return errorResponse(c, 400, ErrorCodes.INVALID_JSON, "Task payload exceeds 4KB limit");
      }

      const { txId, consensusTimestamp } = await submitTaskMessage(message);

      const cached = {
        taskId,
        posterDid,
        title,
        description,
        priceHbar,
        capabilities,
        deadline,
        status: "posted" as const,
        txId,
        consensusTimestamp: consensusTimestamp ?? `pending-consensus:${txId}`,
        createdAt: timestamp,
      };
      upsert(cached);

      logger.info("Marketplace task posted", { txId, taskId, posterDid });

      return c.json({ txId, taskId, timestamp, _links: taskLinks(taskId, posterDid, "posted") }, 200);
    } catch (err) {
      const pub = toPublicError(err);
      logger.error("Marketplace task submission failed", { error: err instanceof Error ? err.message : String(err) });
      return errorResponse(c, 500, pub.code, pub.safeMessage, { retryable: true });
    }
}

export async function listMarketTasks(c: Context): Promise<Response> {
    const capability = c.req.query("capability");
    const limitParam = c.req.query("limit");
    const offsetParam = c.req.query("offset");

    try {
      const { limit, offset } = validatePagination(limitParam, offsetParam);
      const result = listTasks({ capability, limit, offset });
      const tasksWithLinks = result.tasks.map((t) => ({
        ...t,
        _links: taskLinks(t.taskId, t.posterDid, t.status),
      }));

      return c.json(
        {
          tasks: tasksWithLinks,
          count: tasksWithLinks.length,
          total: result.total,
          limit,
          offset,
        },
        200,
      );
    } catch (err) {
      const pub = toPublicError(err);
      logger.error("Cache error", { error: err instanceof Error ? err.message : String(err) });
      return errorResponse(c, 500, pub.code, pub.safeMessage, { retryable: true });
    }
}

export async function getTask(c: Context): Promise<Response> {
    const taskId = c.req.param("taskId")!;
    const task = get(taskId);

    if (!task) {
      return errorResponse(c, 404, ErrorCodes.TASK_NOT_FOUND, "Task not found");
    }

    return c.json({ task: { ...task, _links: taskLinks(task.taskId, task.posterDid, task.status) } }, 200);
}

export async function claimTask(c: Context): Promise<Response> {
    const taskId = c.req.param("taskId")!;

    let body: Record<string, unknown>;
    try {
      body = await c.req.json();
    } catch {
      return errorResponse(c, 400, ErrorCodes.INVALID_JSON, "Invalid JSON body");
    }

    const { claimerDid } = body as { claimerDid?: string };

    if (!claimerDid || !isValidA2ADid(claimerDid)) {
      return errorResponse(c, 400, ErrorCodes.INVALID_DID_FORMAT, "Invalid claimerDid format");
    }

    // Assert verified DID matches actor field (defense-in-depth)
    const actorMismatch = assertSameActor(c, claimerDid);
    if (actorMismatch) return actorMismatch;

    // SLICE-90-12: Require EXECUTOR passport type for Base Sepolia DIDs
    const typeCheck = await checkPassportType(claimerDid, "EXECUTOR");
    if (typeCheck) return typeCheck;

    const task = getTaskById(taskId);
    if (!task) {
      return errorResponse(c, 404, ErrorCodes.TASK_NOT_FOUND, "Task not found");
    }

    // SLICE-84-1: Atomic reservation before async HCS I/O
    const reservation = reserveTask(taskId, ["posted"], "claiming");
    if (!reservation.ok) {
      return errorResponse(c, 409, ErrorCodes.TASK_ALREADY_CLAIMED, `Task is ${reservation.currentStatus}, cannot claim`);
    }

    try {
      const timestamp = Math.floor(Date.now() / 1000);
      const message = {
        type: "task_claimed" as const,
        taskId,
        claimerDid,
        timestamp,
      };
      const { txId } = await submitTaskMessage(message);

      // SLICE-84-1: Commit from transitional to final state
      const committed = transitionTask(taskId, ["claiming"], "claimed", { claimerDid, claimTxId: txId });
      if (!committed.ok) {
        logger.error("Claim commit failed — task state changed during HCS I/O", { taskId, currentStatus: committed.currentStatus });
        return errorResponse(c, 409, ErrorCodes.TASK_ALREADY_CLAIMED, "Task state changed during claim");
      }

      // SLICE-24-8: Create escrow scheduled transfer (poster → claimer)
      try {
        // SLICE-90-13: Check session budget cap before escrow (Base Sepolia only)
        const sessionId = Number(c.req.header("X-SESSION-ID") ?? 0);
        const capCheck = await checkSessionCap(claimerDid, task.priceHbar, sessionId);
        if (capCheck) {
          transitionTask(taskId, ["claiming"], "posted", { claimerDid: undefined });
          return capCheck;
        }

        const fromAccountId = await didToAccountId(task.posterDid);
        const toAccountId = await didToAccountId(claimerDid);
        if (!fromAccountId || !toAccountId) {
          logger.error("Escrow creation failed: could not resolve DID to account ID", { taskId, posterDid: task.posterDid, claimerDid });
          // SLICE-84-2: Emit failure event instead of silent revert
          try {
            await submitTaskMessage({ type: "task_escrow_failed", taskId, reason: "Could not resolve DID to account ID", timestamp });
          } catch (hcsErr) {
            logger.error("Failed to emit task_escrow_failed", { taskId, error: hcsErr instanceof Error ? hcsErr.message : String(hcsErr) });
          }
          returnTaskToMarket(taskId);
          return errorResponse(c, 400, ErrorCodes.INTERNAL_ERROR, "Could not resolve DID to account ID for escrow creation");
        }

        const { scheduleId, scheduleTxId } = await createScheduledTransfer(
          fromAccountId,
          toAccountId,
          task.priceHbar,
          { memo: `escrow:${task.taskId}:${claimerDid}` },
        );

        // SLICE-84-2: WAL — persist scheduleId BEFORE HCS message
        setEscrowStatus(taskId, "pending", { scheduleId, scheduleTxId });

        const escrowMessage = {
          type: "task_escrow_created" as const,
          taskId,
          scheduleId,
          amountHbar: task.priceHbar,
          timestamp,
        };
        await submitTaskMessage(escrowMessage);

        logger.info("Marketplace task claimed with escrow", { txId, taskId, claimerDid, scheduleId });
        return c.json({ taskId, txId, scheduleId, timestamp }, 200);
      } catch (escrowErr) {
        const escrowMsg = escrowErr instanceof Error ? escrowErr.message : "Escrow creation failed";
        logger.error("Escrow creation failed, reverting task to posted", { error: escrowMsg, taskId });
        // SLICE-84-2: Emit task_escrow_failed HCS event instead of silent revert
        try {
          await submitTaskMessage({ type: "task_escrow_failed", taskId, reason: escrowMsg, timestamp });
        } catch (hcsErr) {
          logger.error("Failed to emit task_escrow_failed", { taskId, error: hcsErr instanceof Error ? hcsErr.message : String(hcsErr) });
        }
        returnTaskToMarket(taskId);
        return errorResponse(c, 500, ErrorCodes.HCS_SUBMISSION_FAILED, `Claim succeeded but escrow creation failed: ${escrowMsg}`, { retryable: true });
      }
    } catch (err) {
      // SLICE-84-1: Rollback reservation on HCS failure
      transitionTask(taskId, ["claiming"], "posted", { claimerDid: undefined });
      const pub = toPublicError(err);
      logger.error("Marketplace task claim failed", { error: err instanceof Error ? err.message : String(err) });
      return errorResponse(c, 500, pub.code, pub.safeMessage, { retryable: true });
    }
}

export async function deliverTask(c: Context): Promise<Response> {
    const taskId = c.req.param("taskId")!;

    let body: Record<string, unknown>;
    try {
      body = await c.req.json();
    } catch {
      return errorResponse(c, 400, ErrorCodes.INVALID_JSON, "Invalid JSON body");
    }

    const { claimerDid, resultIpfs, resultBody } = body as {
      claimerDid?: string;
      resultIpfs?: string;
      resultBody?: string;
    };

    if (!claimerDid || !isValidA2ADid(claimerDid)) {
      return errorResponse(c, 400, ErrorCodes.INVALID_DID_FORMAT, "Invalid claimerDid format");
    }

    if (!resultIpfs && !resultBody) {
      return errorResponse(c, 400, ErrorCodes.MISSING_FIELDS, "Either resultIpfs or resultBody required");
    }

    if (resultBody && Buffer.byteLength(resultBody, "utf8") > 4096) {
      return errorResponse(c, 400, ErrorCodes.INVALID_JSON, `resultBody too large (${Buffer.byteLength(resultBody, "utf8")} bytes, max 4096). Use IPFS for larger results.`);
    }

    // Assert verified DID matches actor field (defense-in-depth)
    const actorMismatch = assertSameActor(c, claimerDid);
    if (actorMismatch) return actorMismatch;

    // SLICE-90-12: Require EXECUTOR passport type for Base Sepolia DIDs
    const typeCheck = await checkPassportType(claimerDid, "EXECUTOR");
    if (typeCheck) return typeCheck;

    const task = getTaskById(taskId);
    if (!task) {
      return errorResponse(c, 404, ErrorCodes.TASK_NOT_FOUND, "Task not found");
    }

    if (task.claimerDid !== claimerDid) {
      return errorResponse(c, 403, ErrorCodes.PASSPORT_OWNERSHIP_MISMATCH, "Only claimer can deliver");
    }

    // SLICE-84-1: Atomic reservation before async HCS I/O
    const reservation = reserveTask(taskId, ["claimed"], "delivering");
    if (!reservation.ok) {
      return errorResponse(c, 409, ErrorCodes.TASK_ALREADY_CLAIMED, `Task is ${reservation.currentStatus}, cannot deliver`);
    }

    try {
      const timestamp = Math.floor(Date.now() / 1000);
      const message = {
        type: "task_delivered" as const,
        taskId,
        claimerDid,
        resultIpfs,
        resultBody,
        timestamp,
      };
      const { txId } = await submitTaskMessage(message);

      // SLICE-84-1: Commit from transitional to final state
      const committed = transitionTask(taskId, ["delivering"], "delivered", { resultIpfs, resultBody, deliverTxId: txId });
      if (!committed.ok) {
        logger.error("Deliver commit failed — task state changed during HCS I/O", { taskId, currentStatus: committed.currentStatus });
        return errorResponse(c, 409, ErrorCodes.TASK_ALREADY_CLAIMED, "Task state changed during delivery");
      }

      logger.info("Marketplace task delivered", { txId, taskId, claimerDid });

      return c.json({ taskId, txId, timestamp }, 200);
    } catch (err) {
      // SLICE-84-1: Rollback reservation on failure
      transitionTask(taskId, ["delivering"], "claimed");
      const pub = toPublicError(err);
      logger.error("Marketplace task delivery failed", { error: err instanceof Error ? err.message : String(err) });
      return errorResponse(c, 500, pub.code, pub.safeMessage, { retryable: true });
    }
}

export async function completeTask(c: Context): Promise<Response> {
    let body: Record<string, unknown>;
    try {
      body = await c.req.json();
    } catch {
      return errorResponse(c, 400, ErrorCodes.INVALID_JSON, "Invalid JSON body");
    }

    const { posterDid, txBytes, publicKey, signature, posterPrivateKey } = body as {
      posterDid?: string;
      txBytes?: string;
      publicKey?: string;
      signature?: string;
      posterPrivateKey?: string;
    };

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
      return errorResponse(c, 403, ErrorCodes.PASSPORT_OWNERSHIP_MISMATCH, "Only the task poster can complete this task");
    }

    if (task.status !== "delivered") {
      return errorResponse(c, 400, ErrorCodes.INVALID_JSON, `Task must be in delivered status, current: ${task.status}`);
    }

    if (!task.claimerDid) {
      return errorResponse(c, 400, ErrorCodes.MISSING_FIELDS, "Task has no claimer assigned");
    }

    const hasSignature = txBytes && publicKey && signature;
    const hasPrivateKey = !!posterPrivateKey;

    if (!hasSignature && !hasPrivateKey) {
      return errorResponse(c, 400, ErrorCodes.MISSING_FIELDS, "Payment method required: provide (txBytes + publicKey + signature) or posterPrivateKey");
    }

    // Escrow active: accept signature-based release (EPIC-83 SLICE-83-1) or posterPrivateKey
    const hasEscrowSignature = task.scheduleId && txBytes && publicKey && signature;
    if (task.scheduleId && !hasPrivateKey && !hasEscrowSignature) {
      return errorResponse(
        c,
        400,
        ErrorCodes.ESCROW_SIGNATURE_REQUIRED,
        "Escrow is active (scheduleId exists). Provide (scheduleId + txBytes + publicKey + signature) for keyless release, " +
        "or posterPrivateKey. Use complete_task_with_key MCP tool for convenience.",
      );
    }

    // Validate signature fields completeness for escrow signature path
    if (task.scheduleId && !hasPrivateKey) {
      if (!txBytes || !publicKey || !signature) {
        return errorResponse(c, 400, ErrorCodes.MISSING_FIELDS, "Escrow signature release requires all of: txBytes, publicKey, signature");
      }
    }

    // EPIC-83 SLICE-83-1: Verify signer is authorized for this escrow
    if (task.scheduleId && hasEscrowSignature) {
      const scheduleInfo = await getScheduleInfo(task.scheduleId);
      if (scheduleInfo && scheduleInfo.signers.length > 0) {
        const isKnownSigner = scheduleInfo.signers.some((s) => s === publicKey);
        if (!isKnownSigner) {
          return errorResponse(c, 403, ErrorCodes.WRONG_SIGNER, "Provided public key is not an authorized signer for this scheduled transaction");
        }
      }
    }

    // SLICE-84-1: Atomic reservation before async verification+payment+HCS I/O
    const reservation = reserveTask(taskId, ["delivered"], "completing");
    if (!reservation.ok) {
      return errorResponse(c, 409, ErrorCodes.TASK_ALREADY_CLAIMED, `Task is ${reservation.currentStatus}, cannot complete`);
    }

    try {
      // SLICE-24-9: Run verification BEFORE releasing payment
      const verification = await runVerification(task, task.resultBody, task.resultIpfs);

      if (!verification.passed) {
        updateTaskVerificationAttempts(taskId, verification.attempts);

        if (verification.shouldReturnToMarket) {
          // 3 failed attempts: cancel escrow + return to market
          if (task.scheduleId) {
            try {
              await deleteScheduledTransaction(task.scheduleId);
              setEscrowStatus(taskId, "cancelled");
            } catch (cancelErr) {
              logger.error("Escrow cancellation failed during verification failure", { error: cancelErr instanceof Error ? cancelErr.message : "unknown", taskId });
            }
          }
          returnTaskToMarket(taskId);
          return errorResponse(c, 422, "VERIFICATION_FAILED", `Verification failed after ${verification.attempts} attempts, task returned to marketplace: ${verification.result.report}`);
        }

        // < 3 attempts: stay in delivered, agent can retry
        return errorResponse(c, 422, "VERIFICATION_FAILED", `Verification failed (attempt ${verification.attempts}/3): ${verification.result.report}`);
      }

      // Verification passed → release escrow or direct transfer
      let paymentTxId: string;

      if (task.scheduleId) {
        // Escrow path: release scheduled HBAR transfer
        // EPIC-83 SLICE-83-1: prefer signature-based release (no private key on server)
        if (hasEscrowSignature) {
          const signatureBytes = parseSignatureB64(signature!);
          const result = await signScheduledTransactionWithSignature(task.scheduleId, txBytes!, publicKey!, signatureBytes);
          paymentTxId = result.txId;
        } else {
          // Legacy: posterPrivateKey path (will be deprecated in SLICE-83-2)
          const result = await signScheduledTransaction(task.scheduleId, posterPrivateKey!);
          paymentTxId = result.txId;
        }
        setEscrowStatus(taskId, "released");
      } else {
        // Backward compat: no escrow, direct transfer
        const toAccountId = await didToAccountId(task.claimerDid);
        if (!toAccountId) {
          return errorResponse(c, 400, ErrorCodes.INTERNAL_ERROR, "Could not resolve claimer DID to account ID");
        }
        if (hasSignature) {
          const signatureBytes = parseSignatureB64(signature!);
          paymentTxId = await transferHbarWithSignature(txBytes!, publicKey!, signatureBytes);
        } else {
          const fromAccountId = await didToAccountId(posterDid);
          if (!fromAccountId) {
            return errorResponse(c, 400, ErrorCodes.INTERNAL_ERROR, "Could not resolve poster DID to account ID");
          }
          paymentTxId = await transferHbarWithKey(fromAccountId, posterPrivateKey!, toAccountId, task.priceHbar);
        }
      }

      const timestamp = Math.floor(Date.now() / 1000);
      const message = {
        type: "task_completed" as const,
        taskId,
        paymentTxId,
        timestamp,
      };

      const { txId: hcsTxId } = await submitTaskMessage(message);

      // SLICE-84-1: Commit from transitional to final state
      const committed = transitionTask(taskId, ["completing"], "completed", { paymentTxId, completedTxId: hcsTxId });
      if (!committed.ok) {
        logger.error("Complete commit failed — task state changed during I/O", { taskId, currentStatus: committed.currentStatus });
        return errorResponse(c, 409, ErrorCodes.TASK_ALREADY_CLAIMED, "Task state changed during completion");
      }

      logger.info("Marketplace task completed", { hcsTxId, taskId, paymentTxId });

      return c.json({ taskId, paymentTxId, completedAt: timestamp }, 200);
    } catch (err) {
      // SLICE-84-1: Rollback reservation on failure
      transitionTask(taskId, ["completing"], "delivered");
      const pub = toPublicError(err);
      logger.error("Marketplace task completion failed", { error: err instanceof Error ? err.message : String(err), taskId });
      return errorResponse(c, 500, pub.code, pub.safeMessage, { retryable: true });
    }
}
