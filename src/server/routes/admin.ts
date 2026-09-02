/**
 * Admin revocation route.
 *
 * Reference: SLICE-1-5, CONTEXT.md:61-63
 *
 * POST /admin/revoke — wipe NFT, submit audit message (protected by adminAuth)
 */

import { Hono } from "hono";
import { describeRoute, resolver } from "hono-openapi";
import { adminAuth } from "../middleware/adminAuth";
import { revokePassport, rebuildFromHcs, logger } from "@agentbadge/passport";
import { revokeRequestSchema, errorSchema } from "../openapi";
import { ErrorCodes } from "../lib/error-codes";
import { errorResponse } from "../lib/error-response";

/** Request body for revocation. */
export interface RevokeRequestBody {
  tokenId: string;
  serial: number;
  reason: string;
}

export const adminRoutes = new Hono();

adminRoutes.post(
  "/admin/revoke",
  describeRoute({
    tags: ["Admin"],
    summary: "Revoke agent passport",
    description: "Wipes the NFT and submits an audit message. Protected by admin authentication.",
    responses: {
      200: { description: "Passport revoked successfully" },
      400: {
        description: "tokenId and serial are required",
        content: { "application/json": { schema: resolver(errorSchema) } },
      },
      404: {
        description: "Passport not found",
        content: { "application/json": { schema: resolver(errorSchema) } },
      },
      409: {
        description: "Passport already revoked",
        content: { "application/json": { schema: resolver(errorSchema) } },
      },
      500: {
        description: "Revocation failed",
        content: { "application/json": { schema: resolver(errorSchema) } },
      },
    },
  }),
  adminAuth,
  async (c) => {
    let body: RevokeRequestBody;
    try {
      body = await c.req.json();
    } catch {
      return errorResponse(c, 400, ErrorCodes.INVALID_JSON, "Invalid JSON body");
    }

    if (!body.tokenId || !body.serial) {
      return errorResponse(c, 400, ErrorCodes.MISSING_FIELDS, "tokenId and serial are required");
    }

    try {
      const result = await revokePassport(body.tokenId, Number(body.serial), body.reason ?? "");
      return c.json({ success: true, did: result.did }, 200);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      if (message.includes("not found")) {
        return errorResponse(c, 404, ErrorCodes.PASSPORT_NOT_FOUND, message);
      }
      if (message.includes("already revoked")) {
        return errorResponse(c, 409, ErrorCodes.PASSPORT_REVOKED, message);
      }
      return errorResponse(c, 500, ErrorCodes.INTERNAL_ERROR, `Revocation failed: ${message}`, { retryable: true });
    }
  },
);

adminRoutes.post(
  "/admin/rebuild-cache",
  describeRoute({
    tags: ["Admin"],
    summary: "Full directory cache rebuild",
    description:
      "Triggers a full rebuild of the directory cache from HCS messages. Protected by admin authentication.",
    responses: {
      200: { description: "Cache rebuilt successfully" },
      500: {
        description: "Rebuild failed",
        content: { "application/json": { schema: resolver(errorSchema) } },
      },
    },
  }),
  adminAuth,
  async (c) => {
    const topicId = process.env.DIRECTORY_TOPIC_ID;
    if (!topicId) {
      return errorResponse(c, 500, ErrorCodes.INTERNAL_ERROR, "DIRECTORY_TOPIC_ID not configured");
    }

    try {
      const start = Date.now();
      await rebuildFromHcs(topicId);
      logger.info("admin_cache_rebuild", { durationMs: Date.now() - start });
      return c.json({ success: true, durationMs: Date.now() - start }, 200);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return errorResponse(c, 500, ErrorCodes.HCS_SUBMISSION_FAILED, `Rebuild failed: ${message}`, { retryable: true });
    }
  },
);
