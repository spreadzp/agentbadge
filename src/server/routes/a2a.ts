/**
 * A2A Messaging REST API routes.
 *
 * Reference: SLICE-8-3, SLICE-8-4, SLICE-16-2
 *
 * POST   /a2a/send           — send message (server-key, deprecated)
 * POST   /a2a/send-with-key  — send message with agent private key (convenience)
 * POST   /a2a/send-signed    — send pre-signed message (secure)
 * GET    /a2a/inbox          — get inbox for an agent
 * GET    /a2a/conversation   — get conversation between two agents
 */

import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import {
  submitA2AMessage,
  verifyA2ADid,
  isValidA2ADid,
  getMessageDirection,
  prepareA2ATopicMessage,
  signTransactionBytes,
  submitSignedTopicMessage,
} from "@agentgate-hedera/hedera-core";
import { a2aUpsert as upsert, getMessagesByTo, getConversation, validatePagination, paginate, logger } from "@agentgate-hedera/passport";
import { ErrorCodes } from "../lib/error-codes";
import { errorResponse } from "../lib/error-response";
import { requireDidSignature, assertSameActor } from "../middleware/did-auth";
import { keyEndpointGate } from "../middleware/key-endpoint-gate";

export const a2aRoutes = new Hono();

// EPIC-83 SLICE-83-2: Gate key-accepting endpoints (410 Gone unless ALLOW_KEY_ENDPOINTS=true)
a2aRoutes.use("/a2a/*", keyEndpointGate());

// Apply DID signature verification to mutation POST routes (except -with-key endpoints, EPIC-83)
// Middleware self-skips GET/HEAD and -with-key paths
a2aRoutes.use("/a2a/*", requireDidSignature());

a2aRoutes.use("/a2a/*", async (c, next) => {
  await next();
  c.header("X-Robots-Tag", "noindex, nofollow");
});

const MAX_BODY_BYTES = 4096;

// ─── POST /a2a/send ──────────────────────────────────────────────

a2aRoutes.post(
  "/a2a/send",
  describeRoute({
    tags: ["A2A Messaging"],
    summary: "Send message to another agent",
    description:
      "Submit a message to the A2A HCS topic using the server operator key. DEPRECATED: use /a2a/send-with-key or /a2a/send-signed for agent-signed messages.",
    responses: {
      200: { description: "Message sent successfully" },
      400: { description: "Invalid request body or DID format" },
      401: { description: "Missing or invalid DID signature headers" },
      403: { description: "Verified DID does not match sender, or sender/recipient passport not found or revoked" },
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

    const { from, to, body: messageBody, contentType } = body as {
      from?: string;
      to?: string;
      body?: string;
      contentType?: string;
    };

    if (!from || !to || !messageBody) {
      return errorResponse(c, 400, ErrorCodes.MISSING_FIELDS, "Missing required fields: from, to, body");
    }

    if (!isValidA2ADid(from) || !isValidA2ADid(to)) {
      return errorResponse(c, 400, ErrorCodes.INVALID_DID_FORMAT, "Invalid DID format");
    }

    // Assert verified DID matches actor field (defense-in-depth)
    const actorMismatch = assertSameActor(c, from);
    if (actorMismatch) return actorMismatch;

    const fullMessage = JSON.stringify({
      type: "a2a_message",
      from,
      to,
      body: messageBody,
      contentType: contentType || "text/plain",
      timestamp: Math.floor(Date.now() / 1000),
    });

    if (Buffer.byteLength(fullMessage, "utf8") > MAX_BODY_BYTES) {
      return errorResponse(
        c,
        400,
        ErrorCodes.INVALID_JSON,
        `Message body exceeds ${MAX_BODY_BYTES} bytes after JSON encoding`,
      );
    }

    const recipientValid = await verifyA2ADid(to);
    if (!recipientValid) {
      return errorResponse(c, 403, ErrorCodes.PASSPORT_NOT_FOUND, "Recipient passport not found or revoked");
    }

    try {
      const timestamp = Math.floor(Date.now() / 1000);
      const message = {
        type: "a2a_message" as const,
        from,
        to,
        body: messageBody,
        contentType: contentType || "text/plain",
        timestamp,
      };
      const { txId, consensusTimestamp: receiptTs } = await submitA2AMessage(message);

      const consensusTimestamp = receiptTs ?? `pending-consensus:${txId}`;
      upsert({ ...message, txId, consensusTimestamp });

      logger.info("A2A message sent", { txId, from, to });

      return c.json({ txId, messageId: consensusTimestamp, timestamp }, 200);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "HCS submission failed";
      logger.error("A2A message submission failed", { error: msg });
      return errorResponse(c, 500, ErrorCodes.HCS_SUBMISSION_FAILED, msg, { retryable: true });
    }
  },
);

// ─── POST /a2a/send-with-key ─────────────────────────────────────

a2aRoutes.post(
  "/a2a/send-with-key",
  describeRoute({
    tags: ["A2A Messaging"],
    summary: "Send message with agent private key (convenience mode)",
    description:
      "Submit a signed A2A message using the agent's private key. The server prepares the HCS transaction, signs it with the provided key, and submits it. The transaction ID uses the agent's account, proving authorship.",
    responses: {
      200: { description: "Message sent successfully" },
      400: { description: "Invalid request body or DID format" },
      403: { description: "Sender or recipient passport not found or revoked" },
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

    const { from, to, body: messageBody, contentType, fromAccountId, privateKey } = body as {
      from?: string;
      to?: string;
      body?: string;
      contentType?: string;
      fromAccountId?: string;
      privateKey?: string;
    };

    if (!from || !to || !messageBody) {
      return errorResponse(c, 400, ErrorCodes.MISSING_FIELDS, "Missing required fields: from, to, body");
    }
    if (!fromAccountId || !privateKey) {
      return errorResponse(c, 400, ErrorCodes.MISSING_FIELDS, "Missing required fields: fromAccountId, privateKey");
    }
    if (!isValidA2ADid(from) || !isValidA2ADid(to)) {
      return errorResponse(c, 400, ErrorCodes.INVALID_DID_FORMAT, "Invalid DID format");
    }

    const fullMessage = JSON.stringify({
      type: "a2a_message",
      from,
      to,
      body: messageBody,
      contentType: contentType || "text/plain",
      timestamp: Math.floor(Date.now() / 1000),
    });

    if (Buffer.byteLength(fullMessage, "utf8") > MAX_BODY_BYTES) {
      return errorResponse(
        c,
        400,
        ErrorCodes.INVALID_JSON,
        `Message body exceeds ${MAX_BODY_BYTES} bytes after JSON encoding`,
      );
    }

    const senderValid = await verifyA2ADid(from);
    if (!senderValid) {
      return errorResponse(c, 403, ErrorCodes.PASSPORT_NOT_FOUND, "Sender passport not found or revoked");
    }

    const recipientValid = await verifyA2ADid(to);
    if (!recipientValid) {
      return errorResponse(c, 403, ErrorCodes.PASSPORT_NOT_FOUND, "Recipient passport not found or revoked");
    }

    try {
      const timestamp = Math.floor(Date.now() / 1000);
      const message = {
        type: "a2a_message" as const,
        from,
        to,
        body: messageBody,
        contentType: contentType || "text/plain",
        timestamp,
      };

      const { txBytes } = await prepareA2ATopicMessage(fromAccountId, message);
      const { signature, publicKey } = signTransactionBytes(txBytes, privateKey);
      const sigB64Array = JSON.parse(signature) as string[];
      const signatureBytes = sigB64Array.map((s) => new Uint8Array(Buffer.from(s, "base64")));
      const txId = await submitSignedTopicMessage(txBytes, publicKey, signatureBytes);

      const consensusTimestamp = `pending-consensus:${txId}`;
      upsert({ ...message, txId, consensusTimestamp });

      logger.info("A2A message sent with key", { txId, from, to });

      return c.json({ txId, timestamp }, 200);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Signed A2A submission failed";
      logger.error("Signed A2A submission failed", { error: msg });
      return errorResponse(c, 500, ErrorCodes.HCS_SUBMISSION_FAILED, msg, { retryable: true });
    }
  },
);

// ─── POST /a2a/send-signed ───────────────────────────────────────

a2aRoutes.post(
  "/a2a/send-signed",
  describeRoute({
    tags: ["A2A Messaging"],
    summary: "Send pre-signed message (secure mode)",
    description:
      "Submit a pre-signed A2A message. The agent prepares and signs the transaction locally, then submits the txBytes + signature. The server never sees the private key.",
    responses: {
      200: { description: "Message sent successfully" },
      400: { description: "Invalid request body or DID format" },
      401: { description: "Missing or invalid DID signature headers" },
      403: { description: "Verified DID does not match sender, or sender/recipient passport not found or revoked" },
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

    const { from, to, body: messageBody, contentType, txBytes, publicKey, signature } = body as {
      from?: string;
      to?: string;
      body?: string;
      contentType?: string;
      txBytes?: string;
      publicKey?: string;
      signature?: string;
    };

    if (!from || !to || !messageBody) {
      return errorResponse(c, 400, ErrorCodes.MISSING_FIELDS, "Missing required fields: from, to, body");
    }
    if (!txBytes || !publicKey || !signature) {
      return errorResponse(c, 400, ErrorCodes.MISSING_FIELDS, "Missing required fields: txBytes, publicKey, signature");
    }
    if (!isValidA2ADid(from) || !isValidA2ADid(to)) {
      return errorResponse(c, 400, ErrorCodes.INVALID_DID_FORMAT, "Invalid DID format");
    }

    // Assert verified DID matches actor field (defense-in-depth)
    const actorMismatch = assertSameActor(c, from);
    if (actorMismatch) return actorMismatch;

    const recipientValid = await verifyA2ADid(to);
    if (!recipientValid) {
      return errorResponse(c, 403, ErrorCodes.PASSPORT_NOT_FOUND, "Recipient passport not found or revoked");
    }

    try {
      const sigB64Array = JSON.parse(signature) as string[];
      const signatureBytes = sigB64Array.map((s) => new Uint8Array(Buffer.from(s, "base64")));
      const txId = await submitSignedTopicMessage(txBytes, publicKey, signatureBytes);

      const timestamp = Math.floor(Date.now() / 1000);
      const consensusTimestamp = `pending-consensus:${txId}`;
      const message = {
        type: "a2a_message" as const,
        from,
        to,
        body: messageBody,
        contentType: contentType || "text/plain",
        timestamp,
      };
      upsert({ ...message, txId, consensusTimestamp });

      logger.info("A2A message sent (signed)", { txId, from, to });

      return c.json({ txId, timestamp }, 200);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Signed A2A submission failed";
      logger.error("Signed A2A submission failed", { error: msg });
      return errorResponse(c, 500, ErrorCodes.HCS_SUBMISSION_FAILED, msg, { retryable: true });
    }
  },
);

// ─── GET /a2a/inbox?did=X ────────────────────────────────────────

a2aRoutes.get(
  "/a2a/inbox",
  describeRoute({
    tags: ["A2A Messaging"],
    summary: "Get inbox for an agent",
    description: "Retrieve all messages addressed to the given agent DID, sorted newest first.",
    responses: {
      200: { description: "Inbox retrieved successfully" },
      400: { description: "Invalid or missing DID parameter" },
      500: { description: "Cache error" },
    },
  }),
  async (c) => {
    const did = c.req.query("did");

    if (!did || !isValidA2ADid(did)) {
      return errorResponse(c, 400, ErrorCodes.INVALID_DID_FORMAT, "Invalid or missing DID parameter");
    }

    try {
      const messages = getMessagesByTo(did);
      return c.json({ messages, count: messages.length }, 200);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Cache error";
      return errorResponse(c, 500, ErrorCodes.INTERNAL_ERROR, msg, { retryable: true });
    }
  },
);

// ─── GET /a2a/conversation?didA=X&didB=Y ─────────────────────────

a2aRoutes.get(
  "/a2a/conversation",
  describeRoute({
    tags: ["A2A Messaging"],
    summary: "Get conversation between two agents",
    description:
      "Retrieve bidirectional message history between two agents, sorted oldest first, with pagination.",
    responses: {
      200: { description: "Conversation retrieved successfully" },
      400: { description: "Invalid or missing DID parameters" },
      500: { description: "Cache error" },
    },
  }),
  async (c) => {
    const didA = c.req.query("didA");
    const didB = c.req.query("didB");
    const limitParam = c.req.query("limit");
    const offsetParam = c.req.query("offset");

    if (!didA || !didB || !isValidA2ADid(didA) || !isValidA2ADid(didB)) {
      return errorResponse(c, 400, ErrorCodes.INVALID_DID_FORMAT, "Invalid or missing didA/didB parameters");
    }

    if (didA === didB) {
      return errorResponse(c, 400, ErrorCodes.INVALID_DID_FORMAT, "didA and didB must be different");
    }

    try {
      const allMessages = getConversation(didA, didB);
      const total = allMessages.length;

      const { limit, offset } = validatePagination(limitParam, offsetParam);
      const messages = paginate(allMessages, limit, offset);

      const messagesWithDirection = messages.map((msg) => ({
        ...msg,
        direction: getMessageDirection(msg.from, msg.to, didA, didB),
      }));

      return c.json(
        {
          didA,
          didB,
          messages: messagesWithDirection,
          count: messagesWithDirection.length,
          total,
          limit,
          offset,
        },
        200,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Cache error";
      return errorResponse(c, 500, ErrorCodes.INTERNAL_ERROR, msg, { retryable: true });
    }
  },
);
