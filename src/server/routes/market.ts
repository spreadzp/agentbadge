/**
 * Marketplace REST API routes.
 *
 * Reference: SLICE-9-3
 *
 * POST   /market/tasks   — post a new task to the marketplace
 * GET    /market/tasks   — list marketplace tasks with optional filters
 * GET    /market/tasks/:taskId — get a specific task
 * POST   /market/tasks/:taskId/claim — claim a task
 * POST   /market/tasks/:taskId/deliver — deliver task results
 * POST   /market/tasks/:taskId/complete — complete task with P2P HBAR payment
 */

import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { submitTaskMessage, verifyA2ADid, transferHbarWithKey, prepareTransferTransaction, transferHbarWithSignature, isValidA2ADid, didToAccountId, signTransactionBytes, prepareTopicMessageTransaction, submitSignedTopicMessage, createScheduledTransfer, signScheduledTransaction, signScheduledTransactionWithSignature, deleteScheduledTransaction, getScheduleInfo } from "@agentgate-hedera/hedera-core";
// SLICE-84-3: ULID for task IDs
import { generateReportId as generateUlid } from "../../agent-readiness/integrity/ulid";
import { marketUpsert as upsert, listTasks, marketGet as get, getTaskById, updateTaskStatus, setEscrowStatus, returnTaskToMarket, updateTaskVerificationAttempts, validatePagination, logger, reserveTask, transitionTask } from "@agentgate-hedera/passport";
import { ErrorCodes } from "../lib/error-codes";
import { errorResponse } from "../lib/error-response";
import { taskLinks } from "../lib/hateoas";
import { runVerification } from "../../verifiers";
import { requireDidSignature, assertSameActor } from "../middleware/did-auth";
import { keyEndpointGate } from "../middleware/key-endpoint-gate";
import { toPublicError } from "../lib/error-map";
// TODO(EPIC-90): re-enable when base-core is published to npm
// import { isBaseDid, parseBaseDid, BaseChainAdapter, BASE_SEPOLIA_ADDRESSES, BASE_SEPOLIA_RPC, BASE_SEPOLIA_CHAIN_ID, BASE_SEPOLIA_EXPLORER } from "@agentgate-hedera/base-core";
// import { SessionRegistry } from "@agentgate-hedera/base-core";

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const isBaseDid = (_did: string): boolean => false;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const parseBaseDid = (_did: string): null => null;

export const marketRoutes = new Hono();

// SLICE-90-12: Check passport type for Base Sepolia DIDs
// Returns null if check passes, or a Response if it fails
async function checkPassportType(
  did: string,
  requiredType: "CREATOR" | "EXECUTOR",
): Promise<Response | null> {
  if (!isBaseDid(did)) return null; // Only check Base Sepolia DIDs

  const parsed = parseBaseDid(did);
  if (!parsed) return null;

  const operatorKey = process.env.BASE_OPERATOR_KEY;
  if (!operatorKey) return null; // Skip if Base not configured

  const adapter = new BaseChainAdapter({
    rpcUrl: BASE_SEPOLIA_RPC,
    chainId: BASE_SEPOLIA_CHAIN_ID,
    operatorKey,
    passportNft: BASE_SEPOLIA_ADDRESSES.AgentPassport,
    taskEscrow: BASE_SEPOLIA_ADDRESSES.TaskEscrow,
    usdcAddress: BASE_SEPOLIA_ADDRESSES.MockUSDC,
    explorerUrl: BASE_SEPOLIA_EXPLORER,
  });

  const info = await adapter.getPassportInfo(parsed.nftAddress, parsed.tokenId);
  if (!info) {
    return new Response(
      JSON.stringify({ error: { code: ErrorCodes.PASSPORT_NOT_FOUND, message: "Passport not found on Base Sepolia" } }),
      { status: 403, headers: { "Content-Type": "application/json" } },
    );
  }

  if (info.deleted) {
    return new Response(
      JSON.stringify({ error: { code: ErrorCodes.PASSPORT_REVOKED, message: "Passport is revoked" } }),
      { status: 403, headers: { "Content-Type": "application/json" } },
    );
  }

  if (info.passportType !== requiredType) {
    return new Response(
      JSON.stringify({
        error: {
          code: ErrorCodes.PASSPORT_TYPE_MISMATCH,
          message: `Passport type ${info.passportType} does not match required type ${requiredType}`,
        },
      }),
      { status: 403, headers: { "Content-Type": "application/json" } },
    );
  }

  return null;
}

// SLICE-90-13: Check session budget cap for Base Sepolia DIDs
// Returns null if check passes or is not applicable, or a Response if it fails
async function checkSessionCap(
  did: string,
  amount: number,
  sessionId: number,
): Promise<Response | null> {
  if (!isBaseDid(did)) return null; // Only check Base Sepolia DIDs

  const operatorKey = process.env.BASE_OPERATOR_KEY;
  if (!operatorKey) return null; // Skip if Base not configured

  const sessionRegistryAddr = BASE_SEPOLIA_ADDRESSES.SessionRegistry;
  if (sessionRegistryAddr === "0x0000000000000000000000000000000000000000") return null; // Skip if not deployed

  if (!sessionId) return null; // No session → skip

  const registry = new SessionRegistry(sessionRegistryAddr, {
    rpcUrl: BASE_SEPOLIA_RPC,
    chainId: BASE_SEPOLIA_CHAIN_ID,
    operatorKey,
    passportNft: BASE_SEPOLIA_ADDRESSES.AgentPassport,
    taskEscrow: BASE_SEPOLIA_ADDRESSES.TaskEscrow,
    usdcAddress: BASE_SEPOLIA_ADDRESSES.MockUSDC,
    explorerUrl: BASE_SEPOLIA_EXPLORER,
  });

  const amountWei = BigInt(Math.floor(amount * 1e6)); // USDC has 6 decimals
  const check = await registry.checkSessionValid(sessionId, amountWei);
  if (!check.ok) {
    return new Response(
      JSON.stringify({
        error: {
          code: ErrorCodes.SESSION_BUDGET_EXCEEDED,
          message: `Session budget check failed: ${check.reason}`,
        },
      }),
      { status: 402, headers: { "Content-Type": "application/json" } },
    );
  }

  return null;
}
function parseSignatureB64(signatureB64: string): Uint8Array[] {
  const sigB64Array = JSON.parse(signatureB64) as string[];
  return sigB64Array.map((s) => new Uint8Array(Buffer.from(s, "base64")));
}

// EPIC-83 SLICE-83-2: Gate key-accepting endpoints (410 Gone unless ALLOW_KEY_ENDPOINTS=true)
marketRoutes.use("/market/*", keyEndpointGate());

// Apply DID signature verification to all mutation POST routes (except -with-key endpoints, EPIC-83)
// Middleware self-skips GET/HEAD and -with-key paths
marketRoutes.use("/market/*", requireDidSignature());

// ─── POST /market/tasks ──────────────────────────────────────────

marketRoutes.post(
  "/market/tasks",
  describeRoute({
    tags: ["Marketplace"],
    summary: "Post a new task to the marketplace",
    description:
      "Submit a task to the marketplace HCS topic. Poster passport is verified via Mirror Node.",
    responses: {
      200: { description: "Task posted successfully" },
      400: { description: "Invalid request body or DID format" },
      401: { description: "Missing or invalid DID signature headers" },
      403: { description: "Verified DID does not match posterDid or passport not found" },
      500: { description: "HCS submission failure" },
    },
  }),
  async (c) => {
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
  },
);

// ─── GET /market/tasks?capability=X&limit=Y&offset=Z ─────────────

marketRoutes.get(
  "/market/tasks",
  describeRoute({
    tags: ["Marketplace"],
    summary: "List marketplace tasks",
    description:
      "Retrieve marketplace tasks with optional capability filter and pagination. Sorted newest first.",
    responses: {
      200: { description: "Tasks retrieved successfully" },
      400: { description: "Invalid pagination parameters" },
      500: { description: "Cache error" },
    },
  }),
  async (c) => {
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
  },
);

// ─── GET /market/tasks/:taskId ────────────────────────────────────

marketRoutes.get(
  "/market/tasks/:taskId",
  describeRoute({
    tags: ["Marketplace"],
    summary: "Get a specific task by ID",
    description: "Retrieve a single marketplace task by its task ID.",
    responses: {
      200: { description: "Task retrieved successfully" },
      404: { description: "Task not found" },
    },
  }),
  async (c) => {
    const taskId = c.req.param("taskId");
    const task = get(taskId);

    if (!task) {
      return errorResponse(c, 404, ErrorCodes.TASK_NOT_FOUND, "Task not found");
    }

    return c.json({ task: { ...task, _links: taskLinks(task.taskId, task.posterDid, task.status) } }, 200);
  },
);

// ─── POST /market/tasks/:taskId/claim ─────────────────────────────

marketRoutes.post(
  "/market/tasks/:taskId/claim",
  describeRoute({
    tags: ["Marketplace"],
    summary: "Claim a task",
    description: "Claim a marketplace task. Task must be in 'posted' status. Claimer passport is verified.",
    responses: {
      200: { description: "Task claimed successfully" },
      400: { description: "Invalid request body or DID format" },
      401: { description: "Missing or invalid DID signature headers" },
      403: { description: "Verified DID does not match claimerDid or passport not found" },
      404: { description: "Task not found" },
      409: { description: "Task is not in 'posted' status" },
      500: { description: "HCS submission failure" },
    },
  }),
  async (c) => {
    const taskId = c.req.param("taskId");

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
  },
);

// ─── POST /market/tasks/:taskId/deliver──────────────────────────

marketRoutes.post(
  "/market/tasks/:taskId/deliver",
  describeRoute({
    tags: ["Marketplace"],
    summary: "Deliver task results",
    description: "Submit results for a claimed task. Only the claimer can deliver. resultBody max 4KB — use IPFS for larger results.",
    responses: {
      200: { description: "Task delivered successfully" },
      400: { description: "Invalid request body, missing results, or resultBody too large" },
      401: { description: "Missing or invalid DID signature headers" },
      403: { description: "Verified DID does not match claimerDid or only claimer can deliver" },
      404: { description: "Task not found" },
      409: { description: "Task is not in 'claimed' status" },
      500: { description: "HCS submission failure" },
    },
  }),
  async (c) => {
    const taskId = c.req.param("taskId");

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
  },
);

// ─── POST /market/tasks/:taskId/claim-with-key (SLICE-15-4) ───────

marketRoutes.post(
  "/market/tasks/:taskId/claim-with-key",
  describeRoute({
    tags: ["Marketplace"],
    summary: "Claim a task with agent-signed HCS message (convenience: prepare + sign + submit)",
    description:
      "Combines HCS message preparation → signing → submission. " +
      "Provide claimerDid and claimerPrivateKey. Server creates HCS transaction with agent as payer, " +
      "signs it, submits to Hedera. HCS transaction ID uses claimer's account. (SLICE-15-4)",
    responses: {
      200: { description: "Task claimed with agent-signed HCS transaction" },
      400: { description: "Missing required fields or invalid input" },
      403: { description: "Claimer passport not found or revoked" },
      404: { description: "Task not found" },
      409: { description: "Task is not in 'posted' status" },
      500: { description: "HCS submission failure" },
    },
  }),
  async (c) => {
    const taskId = c.req.param("taskId");

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
  },
);

// ─── POST /market/tasks/:taskId/deliver-with-key (SLICE-15-4) ─────

marketRoutes.post(
  "/market/tasks/:taskId/deliver-with-key",
  describeRoute({
    tags: ["Marketplace"],
    summary: "Deliver task results with agent-signed HCS message (convenience: prepare + sign + submit)",
    description:
      "Combines HCS message preparation → signing → submission. " +
      "Provide claimerDid, claimerPrivateKey, and either resultBody or resultIpfs. " +
      "Server creates HCS transaction with agent as payer, signs it, submits to Hedera. (SLICE-15-4)",
    responses: {
      200: { description: "Task delivered with agent-signed HCS transaction" },
      400: { description: "Missing required fields or invalid input" },
      403: { description: "Only the claimer can deliver" },
      404: { description: "Task not found" },
      409: { description: "Task is not in 'claimed' status" },
      500: { description: "HCS submission failure" },
    },
  }),
  async (c) => {
    const taskId = c.req.param("taskId");

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
  },
);

// ─── POST /market/tasks/:taskId/prepare-payment ──────────────────

marketRoutes.post(
  "/market/tasks/:taskId/prepare-payment",
  describeRoute({
    tags: ["Marketplace"],
    summary: "Prepare a P2P HBAR payment for task completion",
    description:
      "Prepares a frozen TransferTransaction for offline signing by the poster. " +
      "Returns base64-encoded txBytes, txId, and resolved account IDs. " +
      "Poster signs locally and submits via /complete with txBytes + publicKey + signature. (SLICE-12-2)",
    responses: {
      200: { description: "Transaction prepared successfully" },
      400: { description: "Task not in delivered status or missing claimer" },
      401: { description: "Missing or invalid DID signature headers" },
      403: { description: "Verified DID does not match posterDid or caller is not the poster" },
      404: { description: "Task not found" },
      500: { description: "Transaction preparation failure" },
    },
  }),
  async (c) => {
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

    const taskId = c.req.param("taskId");
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
  },
);

// ─── POST /market/tasks/:taskId/complete ──────────────────────────

marketRoutes.post(
  "/market/tasks/:taskId/complete",
  describeRoute({
    tags: ["Marketplace"],
    summary: "Complete a task with P2P HBAR payment",
    description:
      "Poster completes a delivered task by transferring HBAR to the claimer. " +
      "When escrow is active (scheduleId exists), posterPrivateKey is required to release the scheduled transfer — " +
      "signature-based direct transfer is forbidden. Without escrow, accepts (txBytes + publicKey + signature) or posterPrivateKey. (SLICE-12-3)",
    responses: {
      200: { description: "Task completed successfully" },
      400: { description: "Task not in delivered status, missing claimer, or missing payment fields" },
      401: { description: "Missing or invalid DID signature headers" },
      403: { description: "Verified DID does not match posterDid or caller is not the poster" },
      404: { description: "Task not found" },
      500: { description: "Payment or HCS submission failure" },
    },
  }),
  async (c) => {
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

    const taskId = c.req.param("taskId");
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
  },
);

// ─── POST /market/sign — sign frozen transaction bytes (SLICE-15-1) ───

marketRoutes.post(
  "/market/sign",
  describeRoute({
    tags: ["Marketplace"],
    summary: "Sign frozen Hedera transaction bytes with a private key",
    description:
      "Takes base64-encoded frozen transaction bytes and a private key, returns the signature and public key. " +
      "Pure local operation — no network calls. Supports both ECDSA (0x... hex) and ED25519 (302e... DER) key formats. (SLICE-15-1)",
    responses: {
      200: { description: "Signature and public key returned" },
      400: { description: "Missing or invalid txBytes / privateKey" },
      401: { description: "Missing or invalid DID signature headers" },
    },
  }),
  async (c) => {
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
  },
);

// ─── POST /market/tasks/:taskId/complete-with-key (SLICE-15-2) ───

marketRoutes.post(
  "/market/tasks/:taskId/complete-with-key",
  describeRoute({
    tags: ["Marketplace"],
    summary: "Complete task with private key (convenience: prepare + sign + submit + complete in one call)",
    description:
      "Combines prepare_payment → sign → complete into a single call. " +
      "Provide posterDid and posterPrivateKey. Server prepares frozen transfer, signs it, submits to Hedera, and completes the task. (SLICE-15-2)",
    responses: {
      200: { description: "Task completed with paymentTxId" },
      400: { description: "Missing required fields or task not in delivered status" },
      403: { description: "Not the task poster or passport invalid" },
      404: { description: "Task not found" },
    },
  }),
  async (c) => {
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

    const taskId = c.req.param("taskId");
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
  },
);

// ─── POST /market/tasks/signed (SLICE-15-3) ──────────────────────

marketRoutes.post(
  "/market/tasks/signed",
  describeRoute({
    tags: ["Marketplace"],
    summary: "Post a task with agent-signed HCS message (convenience: prepare + sign + submit in one call)",
    description:
      "Combines HCS message preparation → signing → submission into a single call. " +
      "Provide posterDid and posterPrivateKey. Server creates HCS transaction with agent as payer, " +
      "signs it, submits to Hedera, and caches the task. HCS transaction ID uses agent's account. (SLICE-15-3)",
    responses: {
      200: { description: "Task posted with agent-signed HCS transaction" },
      400: { description: "Missing required fields or invalid input" },
      401: { description: "Missing or invalid DID signature headers" },
      403: { description: "Verified DID does not match posterDid or poster passport not found" },
      500: { description: "HCS submission failure" },
    },
  }),
  async (c) => {
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
  },
);

// ─── POST /market/tasks/:taskId/cancel ───────────────────────────

marketRoutes.post(
  "/market/tasks/:taskId/cancel",
  describeRoute({
    tags: ["Marketplace"],
    summary: "Cancel a task and return escrow HBAR to poster",
    description:
      "Poster cancels a task in posted/claimed/delivered status. " +
      "If a scheduled transaction (escrow) exists, it is deleted and HBAR returned. " +
      "Task status set to cancelled. (SLICE-24-10)",
    responses: {
      200: { description: "Task cancelled successfully" },
      400: { description: "Task cannot be cancelled from current status" },
      401: { description: "Missing or invalid DID signature headers" },
      403: { description: "Verified DID does not match posterDid or caller is not the poster" },
      404: { description: "Task not found" },
      500: { description: "Escrow cancellation or HCS submission failed" },
    },
  }),
  async (c) => {
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

    const taskId = c.req.param("taskId");
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
  },
);

// ─── POST /market/tasks/:taskId/increase-reward ──────────────────

marketRoutes.post(
  "/market/tasks/:taskId/increase-reward",
  describeRoute({
    tags: ["Marketplace"],
    summary: "Increase task reward (delete old escrow + create new)",
    description:
      "Poster increases the reward for a task. Old scheduled transaction is deleted, " +
      "new one created with the higher amount. Only allowed in posted/claimed status. (SLICE-24-10)",
    responses: {
      200: { description: "Reward increased successfully" },
      400: { description: "Invalid new price or task status" },
      401: { description: "Missing or invalid DID signature headers" },
      403: { description: "Verified DID does not match posterDid or caller is not the poster" },
      404: { description: "Task not found" },
      500: { description: "Escrow recreation or HCS submission failed" },
    },
  }),
  async (c) => {
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

    const taskId = c.req.param("taskId");
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
  },
);

// ─── GET /market/tasks/:taskId/escrow-status ─────────────────────

marketRoutes.get(
  "/market/tasks/:taskId/escrow-status",
  describeRoute({
    tags: ["Marketplace"],
    summary: "Get escrow status for a task",
    description:
      "Returns escrow fields (scheduleId, escrowStatus, verificationAttempts, verifierType, priceHbar) for a task. (SLICE-24-11)",
    responses: {
      200: { description: "Escrow status returned successfully" },
      404: { description: "Task not found" },
    },
  }),
  (c) => {
    const taskId = c.req.param("taskId");
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
  },
);

// ─── POST /market/tasks/:taskId/verify ───────────────────────────

marketRoutes.post(
  "/market/tasks/:taskId/verify",
  describeRoute({
    tags: ["Marketplace"],
    summary: "Run verification on a task without completing it",
    description:
      "Triggers verification on a delivered task and returns the result. Does NOT complete the task or sign escrow. Useful for manual verification checks. (SLICE-24-11)",
    responses: {
      200: { description: "Verification result returned" },
      400: { description: "Task not in delivered status" },
      404: { description: "Task not found" },
      500: { description: "Verification failed" },
    },
  }),
  async (c) => {
    const taskId = c.req.param("taskId");
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
  },
);
