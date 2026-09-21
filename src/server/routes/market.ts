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
import { requireDidSignature } from "../middleware/did-auth";
import { keyEndpointGate } from "../middleware/key-endpoint-gate";
import {
  postTask, listMarketTasks, getTask, claimTask, deliverTask, completeTask,
} from "../lib/market-handlers-lifecycle";
import {
  claimTaskWithKey, deliverTaskWithKey, completeTaskWithKey, signTx, postSignedTask,
} from "../lib/market-handlers-signed";
import {
  preparePayment, cancelTask, increaseReward, escrowStatus, verifyTask,
} from "../lib/market-handlers-manage";

// Re-exported for backward-compat import path (tests import helpers from routes/market).
export { checkPassportType, checkSessionCap } from "../lib/market-auth";

export const marketRoutes = new Hono();

// EPIC-83 SLICE-83-2: Gate key-accepting endpoints (410 Gone unless ALLOW_KEY_ENDPOINTS=true)
marketRoutes.use("/market/*", keyEndpointGate());

// Apply DID signature verification to all mutation POST routes (except -with-key endpoints, EPIC-83)
// Middleware self-skips GET/HEAD and -with-key paths
marketRoutes.use("/market/*", requireDidSignature());

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
  postTask,
);

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
  listMarketTasks,
);

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
  getTask,
);

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
  claimTask,
);

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
  deliverTask,
);

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
  claimTaskWithKey,
);

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
  deliverTaskWithKey,
);

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
  preparePayment,
);

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
  completeTask,
);

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
  signTx,
);

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
  completeTaskWithKey,
);

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
  postSignedTask,
);

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
  cancelTask,
);

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
  increaseReward,
);

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
  escrowStatus,
);

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
  verifyTask,
);
