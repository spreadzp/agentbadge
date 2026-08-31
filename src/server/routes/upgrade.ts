/**
 * Tier upgrade route.
 *
 * Reference: SLICE-1-4, hackathon-flow.md:110,233
 *
 * POST /passport/:tokenId/:serial/upgrade — upgrade tier in-place
 */

import { Hono } from "hono";
import { describeRoute, resolver } from "hono-openapi";
import type { Tier } from "@agentbadge/hedera-core";
import { upgradeTier, calculateUpgradePrice } from "@agentbadge/passport";
import { upgradeRequestSchema, errorSchema } from "../openapi";
import { ErrorCodes } from "../lib/error-codes";
import { errorResponse } from "../lib/error-response";

export const upgradeRoutes = new Hono();

/** Request body for tier upgrade. */
export interface UpgradeRequestBody {
  newTier: Tier;
  accountId: string;
}

upgradeRoutes.post(
  "/passport/:tokenId/:serial/upgrade",
  describeRoute({
    tags: ["Passport"],
    summary: "Upgrade passport tier",
    description:
      "Upgrades the passport NFT tier in-place by updating metadata and submitting an audit message.",
    responses: {
      200: { description: "Tier upgraded successfully" },
      400: {
        description: "Invalid parameters or downgrade attempt",
        content: { "application/json": { schema: resolver(errorSchema) } },
      },
      403: {
        description: "Passport not owned by requester",
        content: { "application/json": { schema: resolver(errorSchema) } },
      },
      404: {
        description: "Passport not found or revoked",
        content: { "application/json": { schema: resolver(errorSchema) } },
      },
      500: {
        description: "Upgrade failed",
        content: { "application/json": { schema: resolver(errorSchema) } },
      },
    },
  }),
  async (c) => {
    const tokenId = c.req.param("tokenId");
    const serialStr = c.req.param("serial");
    const serial = Number(serialStr);

    if (!tokenId || Number.isNaN(serial)) {
      return errorResponse(c, 400, ErrorCodes.INVALID_JSON, "Invalid tokenId or serial");
    }

    let body: UpgradeRequestBody;
    try {
      const json = await c.req.json();
      body = json as UpgradeRequestBody;
    } catch {
      return errorResponse(c, 400, ErrorCodes.INVALID_JSON, "Invalid JSON body");
    }

    if (!body.newTier || !body.accountId) {
      return errorResponse(c, 400, ErrorCodes.MISSING_FIELDS, "newTier and accountId are required");
    }

    try {
      const result = await upgradeTier(tokenId, serial, body.newTier, body.accountId);
      return c.json(result, 200);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";

      if (message.includes("not found")) {
        return errorResponse(c, 404, ErrorCodes.PASSPORT_NOT_FOUND, message);
      }
      if (message.includes("not owned")) {
        return errorResponse(c, 403, ErrorCodes.PASSPORT_OWNERSHIP_MISMATCH, message);
      }
      if (message.includes("revoked")) {
        return errorResponse(c, 404, ErrorCodes.PASSPORT_REVOKED, message);
      }
      if (message.includes("downgrade") || message.includes("not a forward upgrade")) {
        return errorResponse(c, 400, ErrorCodes.INVALID_JSON, message);
      }

      return errorResponse(c, 500, ErrorCodes.INTERNAL_ERROR, `Upgrade failed: ${message}`, { retryable: true });
    }
  },
);
