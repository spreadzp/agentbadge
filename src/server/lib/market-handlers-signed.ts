// EPIC-140 (SLICE-140-14): market signed route handlers extracted from routes/market.ts.
// Handler implementations; routes/market.ts registers them against paths + describeRoute.
import type { Context } from "hono";
import { submitTaskMessage, verifyA2ADid, prepareTransferTransaction, transferHbarWithSignature, isValidA2ADid, didToAccountId, signTransactionBytes, prepareTopicMessageTransaction, submitSignedTopicMessage, createScheduledTransfer, signScheduledTransaction, deleteScheduledTransaction } from "@agentbadge/hedera-core";
import { generateReportId as generateUlid } from "../../agent-readiness/integrity/ulid";
import { marketUpsert as upsert, getTaskById, updateTaskStatus, setEscrowStatus, returnTaskToMarket, updateTaskVerificationAttempts, logger } from "@agentbadge/passport";
import { ErrorCodes } from "./error-codes";
import { errorResponse } from "./error-response";
import { runVerification } from "../../verifiers";
import { assertSameActor } from "../middleware/did-auth";
import { toPublicError } from "./error-map";
import { parseSignatureB64 } from "./market-auth";

export async function claimTaskWithKey(c: Context): Promise<Response> {
    const taskId = c.req.param("taskId")!;

    let body: Record<string, unknown>;
    try {
      body = await c.req.json();
    } catch {
      return errorResponse(c, 400, ErrorCodes.INVALID_JSON, "Invalid JSON body");
    }

    const { claimerDid, claimerPrivateKey } = body as {
      claimerDid?: string;
      claimerPrivateKey?: string;
    };

    if (!claimerDid) {
      return errorResponse(c, 400, ErrorCodes.MISSING_FIELDS, "Missing required field: claimerDid");
    }
    if (!claimerPrivateKey) {
      return errorResponse(c, 400, ErrorCodes.MISSING_FIELDS, "Missing required field: claimerPrivateKey");
    }
    if (!isValidA2ADid(claimerDid)) {
      return errorResponse(c, 400, ErrorCodes.INVALID_DID_FORMAT, "Invalid claimerDid format");
    }

    const claimerValid = await verifyA2ADid(claimerDid);
    if (!claimerValid) {
      return errorResponse(c, 403, ErrorCodes.PASSPORT_NOT_FOUND, "Claimer passport not found or revoked");
    }

    const task = getTaskById(taskId);
    if (!task) {
      return errorResponse(c, 404, ErrorCodes.TASK_NOT_FOUND, "Task not found");
    }
    if (task.status !== "posted") {
      return errorResponse(c, 409, ErrorCodes.TASK_ALREADY_CLAIMED, `Task is ${task.status}, cannot claim`);
    }

    try {
      const fromAccountId = await didToAccountId(claimerDid);
      if (!fromAccountId) {
        return errorResponse(c, 400, ErrorCodes.INTERNAL_ERROR, "Could not resolve claimer DID to account ID");
      }

      const timestamp = Math.floor(Date.now() / 1000);
      const message = {
        type: "task_claimed" as const,
        taskId,
        claimerDid,
        timestamp,
      };

      const { txBytes } = await prepareTopicMessageTransaction(fromAccountId, message);
      const { signature, publicKey } = signTransactionBytes(txBytes, claimerPrivateKey);
      const signatureBytes = parseSignatureB64(signature);
      const txId = await submitSignedTopicMessage(txBytes, publicKey, signatureBytes);

      updateTaskStatus(taskId, "claimed", { claimerDid, claimTxId: txId });

      // SLICE-24-8: Create escrow scheduled transfer (poster → claimer)
      try {
        const posterAccountId = await didToAccountId(task.posterDid);
        if (!posterAccountId) {
          logger.error("Escrow creation failed: could not resolve poster DID", { taskId, posterDid: task.posterDid });
          // SLICE-84-2: Emit failure event instead of silent revert
          try {
            await submitTaskMessage({ type: "task_escrow_failed", taskId, reason: "Could not resolve poster DID to account ID", timestamp });
          } catch (hcsErr) {
            logger.error("Failed to emit task_escrow_failed", { taskId, error: hcsErr instanceof Error ? hcsErr.message : String(hcsErr) });
          }
          returnTaskToMarket(taskId);
          return errorResponse(c, 400, ErrorCodes.INTERNAL_ERROR, "Could not resolve poster DID to account ID for escrow creation");
        }

        const { scheduleId, scheduleTxId } = await createScheduledTransfer(
          posterAccountId,
          fromAccountId,
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

        logger.info("Marketplace task claimed with key + escrow", { txId, taskId, claimerDid, scheduleId });
        return c.json({ taskId, txId, scheduleId, timestamp }, 200);
      } catch (escrowErr) {
        const escrowMsg = escrowErr instanceof Error ? escrowErr.message : "Escrow creation failed";
        logger.error("Escrow creation failed (claim-with-key), reverting task to posted", { error: escrowMsg, taskId });
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
      const pub = toPublicError(err);
      logger.error("Signed claim failed", { error: err instanceof Error ? err.message : String(err), taskId });
      return errorResponse(c, 500, pub.code, pub.safeMessage, { retryable: true });
    }
}

export async function deliverTaskWithKey(c: Context): Promise<Response> {
    const taskId = c.req.param("taskId")!;

    let body: Record<string, unknown>;
    try {
      body = await c.req.json();
    } catch {
      return errorResponse(c, 400, ErrorCodes.INVALID_JSON, "Invalid JSON body");
    }

    const { claimerDid, resultIpfs, resultBody, claimerPrivateKey } = body as {
      claimerDid?: string;
      resultIpfs?: string;
      resultBody?: string;
      claimerPrivateKey?: string;
    };

    if (!claimerDid) {
      return errorResponse(c, 400, ErrorCodes.MISSING_FIELDS, "Missing required field: claimerDid");
    }
    if (!claimerPrivateKey) {
      return errorResponse(c, 400, ErrorCodes.MISSING_FIELDS, "Missing required field: claimerPrivateKey");
    }
    if (!isValidA2ADid(claimerDid)) {
      return errorResponse(c, 400, ErrorCodes.INVALID_DID_FORMAT, "Invalid claimerDid format");
    }
    if (!resultIpfs && !resultBody) {
      return errorResponse(c, 400, ErrorCodes.MISSING_FIELDS, "Either resultIpfs or resultBody required");
    }
    if (resultBody && Buffer.byteLength(resultBody, "utf8") > 4096) {
      return errorResponse(c, 400, ErrorCodes.INVALID_JSON, `resultBody too large (${Buffer.byteLength(resultBody, "utf8")} bytes, max 4096). Use IPFS for larger results.`);
    }

    const claimerValid = await verifyA2ADid(claimerDid);
    if (!claimerValid) {
      return errorResponse(c, 403, ErrorCodes.PASSPORT_NOT_FOUND, "Claimer passport not found or revoked");
    }

    const task = getTaskById(taskId);
    if (!task) {
      return errorResponse(c, 404, ErrorCodes.TASK_NOT_FOUND, "Task not found");
    }
    if (task.status !== "claimed") {
      return errorResponse(c, 409, ErrorCodes.TASK_ALREADY_CLAIMED, `Task is ${task.status}, cannot deliver`);
    }
    if (task.claimerDid !== claimerDid) {
      return errorResponse(c, 403, ErrorCodes.PASSPORT_OWNERSHIP_MISMATCH, "Only claimer can deliver");
    }

    try {
      const fromAccountId = await didToAccountId(claimerDid);
      if (!fromAccountId) {
        return errorResponse(c, 400, ErrorCodes.INTERNAL_ERROR, "Could not resolve claimer DID to account ID");
      }

      const timestamp = Math.floor(Date.now() / 1000);
      const message = {
        type: "task_delivered" as const,
        taskId,
        claimerDid,
        resultIpfs,
        resultBody,
        timestamp,
      };

      const { txBytes } = await prepareTopicMessageTransaction(fromAccountId, message);
      const { signature, publicKey } = signTransactionBytes(txBytes, claimerPrivateKey);
      const signatureBytes = parseSignatureB64(signature);
      const txId = await submitSignedTopicMessage(txBytes, publicKey, signatureBytes);

      updateTaskStatus(taskId, "delivered", { resultIpfs, resultBody, deliverTxId: txId });

      logger.info("Marketplace task delivered with key", { txId, taskId, claimerDid });

      return c.json({ taskId, txId, timestamp }, 200);
    } catch (err) {
      const pub = toPublicError(err);
      logger.error("Signed delivery failed", { error: err instanceof Error ? err.message : String(err), taskId });
      return errorResponse(c, 500, pub.code, pub.safeMessage, { retryable: true });
    }
}

export async function signTx(c: Context): Promise<Response> {
    let body: Record<string, unknown>;
    try {
      body = await c.req.json();
    } catch {
      return errorResponse(c, 400, ErrorCodes.INVALID_JSON, "Invalid JSON body");
    }

    const { txBytes, privateKey } = body as { txBytes?: string; privateKey?: string };

    if (!txBytes) {
      return errorResponse(c, 400, ErrorCodes.MISSING_FIELDS, "Missing required field: txBytes");
    }
    if (!privateKey) {
      return errorResponse(c, 400, ErrorCodes.MISSING_FIELDS, "Missing required field: privateKey");
    }

    try {
      const result = signTransactionBytes(txBytes, privateKey);
      return c.json(result, 200);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Signing failed";
      logger.error("Signing failed", { error: msg });
      return errorResponse(c, 400, ErrorCodes.INVALID_JSON, msg);
    }
}

export async function completeTaskWithKey(c: Context): Promise<Response> {
    let body: Record<string, unknown>;
    try {
      body = await c.req.json();
    } catch {
      return errorResponse(c, 400, ErrorCodes.INVALID_JSON, "Invalid JSON body");
    }

    const { posterDid, posterPrivateKey } = body as { posterDid?: string; posterPrivateKey?: string };

    if (!posterDid) {
      return errorResponse(c, 400, ErrorCodes.MISSING_FIELDS, "Missing required field: posterDid");
    }
    if (!posterPrivateKey) {
      return errorResponse(c, 400, ErrorCodes.MISSING_FIELDS, "Missing required field: posterPrivateKey");
    }
    if (!isValidA2ADid(posterDid)) {
      return errorResponse(c, 400, ErrorCodes.INVALID_DID_FORMAT, "Invalid posterDid format");
    }

    const taskId = c.req.param("taskId")!;
    const task = getTaskById(taskId);

    if (!task) {
      return errorResponse(c, 404, ErrorCodes.TASK_NOT_FOUND, "Task not found");
    }

    if (task.posterDid !== posterDid) {
      return errorResponse(c, 403, ErrorCodes.PASSPORT_OWNERSHIP_MISMATCH, "Only the task poster can complete this task");
    }

    const posterValid = await verifyA2ADid(posterDid);
    if (!posterValid) {
      return errorResponse(c, 403, ErrorCodes.PASSPORT_NOT_FOUND, "Poster passport not found or revoked");
    }

    if (task.status !== "delivered") {
      return errorResponse(c, 400, ErrorCodes.INVALID_JSON, `Task must be in delivered status, current: ${task.status}`);
    }

    if (!task.claimerDid) {
      return errorResponse(c, 400, ErrorCodes.MISSING_FIELDS, "Task has no claimer assigned");
    }

    try {
      // SLICE-24-9: Run verification BEFORE releasing payment
      const verification = await runVerification(task, task.resultBody, task.resultIpfs);

      if (!verification.passed) {
        updateTaskVerificationAttempts(taskId, verification.attempts);

        if (verification.shouldReturnToMarket) {
          if (task.scheduleId) {
            try {
              await deleteScheduledTransaction(task.scheduleId);
              setEscrowStatus(taskId, "cancelled");
            } catch (cancelErr) {
              logger.error("Escrow cancellation failed during verification failure", { error: cancelErr instanceof Error ? cancelErr.message : "unknown", taskId });
            }
          }
          returnTaskToMarket(taskId);
          return errorResponse(c, 422, ErrorCodes.VERIFICATION_FAILED, `Verification failed after ${verification.attempts} attempts, task returned to marketplace: ${verification.result.report}`);
        }

        return errorResponse(c, 422, ErrorCodes.VERIFICATION_FAILED, `Verification failed (attempt ${verification.attempts}/3): ${verification.result.report}`);
      }

      // Verification passed → release escrow or direct transfer
      let paymentTxId: string;

      if (task.scheduleId) {
        // Escrow path: sign scheduled tx to release HBAR
        const result = await signScheduledTransaction(task.scheduleId, posterPrivateKey);
        paymentTxId = result.txId;
        setEscrowStatus(taskId, "released");
      } else {
        // Backward compat: no escrow, direct transfer
        const fromAccountId = await didToAccountId(posterDid);
        if (!fromAccountId) {
          return errorResponse(c, 400, ErrorCodes.INTERNAL_ERROR, "Could not resolve poster DID to account ID");
        }

        const toAccountId = await didToAccountId(task.claimerDid);
        if (!toAccountId) {
          return errorResponse(c, 400, ErrorCodes.INTERNAL_ERROR, "Could not resolve claimer DID to account ID");
        }

        const { txBytes } = await prepareTransferTransaction(fromAccountId, toAccountId, task.priceHbar);
        const { signature, publicKey } = signTransactionBytes(txBytes, posterPrivateKey);
        const signatureBytes = parseSignatureB64(signature);
        paymentTxId = await transferHbarWithSignature(txBytes, publicKey, signatureBytes);
      }

      const timestamp = Math.floor(Date.now() / 1000);
      const message = {
        type: "task_completed" as const,
        taskId,
        paymentTxId,
        timestamp,
      };

      const { txId: hcsTxId } = await submitTaskMessage(message);

      updateTaskStatus(taskId, "completed", { paymentTxId, completedTxId: hcsTxId });

      logger.info("Marketplace task completed with key", { hcsTxId, taskId, paymentTxId });

      return c.json({ taskId, paymentTxId, completedAt: timestamp }, 200);
    } catch (err) {
      const pub = toPublicError(err);
      logger.error("Complete-with-key failed", { error: err instanceof Error ? err.message : String(err), taskId });
      return errorResponse(c, 500, pub.code, pub.safeMessage, { retryable: true });
    }
}

export async function postSignedTask(c: Context): Promise<Response> {
    let body: Record<string, unknown>;
    try {
      body = await c.req.json();
    } catch {
      return errorResponse(c, 400, ErrorCodes.INVALID_JSON, "Invalid JSON body");
    }

    const { posterDid, title, description, priceHbar, capabilities, deadline, posterPrivateKey } = body as {
      posterDid?: string;
      title?: string;
      description?: string;
      priceHbar?: number;
      capabilities?: string[];
      deadline?: number;
      posterPrivateKey?: string;
    };

    if (!posterDid) {
      return errorResponse(c, 400, ErrorCodes.MISSING_FIELDS, "Missing required field: posterDid");
    }
    if (!title) {
      return errorResponse(c, 400, ErrorCodes.MISSING_FIELDS, "Missing required field: title");
    }
    if (!description) {
      return errorResponse(c, 400, ErrorCodes.MISSING_FIELDS, "Missing required field: description");
    }
    if (priceHbar === undefined) {
      return errorResponse(c, 400, ErrorCodes.MISSING_FIELDS, "Missing required field: priceHbar");
    }
    if (!capabilities) {
      return errorResponse(c, 400, ErrorCodes.MISSING_FIELDS, "Missing required field: capabilities");
    }
    if (!posterPrivateKey) {
      return errorResponse(c, 400, ErrorCodes.MISSING_FIELDS, "Missing required field: posterPrivateKey");
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

    try {
      const fromAccountId = await didToAccountId(posterDid);
      if (!fromAccountId) {
        return errorResponse(c, 400, ErrorCodes.INTERNAL_ERROR, "Could not resolve poster DID to account ID");
      }

      const timestamp = Math.floor(Date.now() / 1000);
      const taskId = `task-${generateUlid()}`;

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

      // 1. Prepare frozen HCS transaction with agent as payer
      const { txBytes } = await prepareTopicMessageTransaction(fromAccountId, message);

      // 2. Sign the frozen transaction bytes with agent's private key
      const { signature, publicKey } = signTransactionBytes(txBytes, posterPrivateKey);
      const signatureBytes = parseSignatureB64(signature);

      // 3. Submit signed transaction to HCS
      const txId = await submitSignedTopicMessage(txBytes, publicKey, signatureBytes);

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
        consensusTimestamp: `pending-consensus:${txId}`,
        createdAt: timestamp,
      };
      upsert(cached);

      logger.info("Marketplace task posted with key", { txId, taskId, posterDid });

      return c.json({ txId, taskId, timestamp }, 200);
    } catch (err) {
      const pub = toPublicError(err);
      logger.error("Signed task posting failed", { error: err instanceof Error ? err.message : String(err) });
      return errorResponse(c, 500, pub.code, pub.safeMessage, { retryable: true });
    }
}
