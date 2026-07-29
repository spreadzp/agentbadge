/**
 * Audit route — GET /audit/:tokenId?/:serial?
 *
 * Reference: hackathon-flow.md:114 (§5), CONTEXT.md:85-87 (§Audit Trail)
 */

import { Hono } from "hono";
import { describeRoute, resolver } from "hono-openapi";
import z from "zod";
import { getAuditTrail } from "@agentgate-hedera/mcp";
import { auditEventSchema, errorSchema } from "../openapi";
import { ErrorCodes } from "../lib/error-codes";
import { errorResponse } from "../lib/error-response";

export const auditRoutes = new Hono();

auditRoutes.get(
  "/audit/:tokenId?/:serial?",
  describeRoute({
    tags: ["Audit"],
    summary: "Get audit trail",
    description:
      "Returns audit events from the HCS passport.audit topic, optionally filtered by tokenId and serial.",
    responses: {
      200: {
        description: "Audit events retrieved",
        content: {
          "application/json": {
            schema: resolver(z.object({ events: z.array(auditEventSchema) })),
          },
        },
      },
      500: {
        description: "Failed to fetch audit trail",
        content: { "application/json": { schema: resolver(errorSchema) } },
      },
    },
  }),
  async (c) => {
    const tokenId = c.req.param("tokenId");
    const serialParam = c.req.param("serial");
    const serial = serialParam ? Number(serialParam) : undefined;

    try {
      const events = await getAuditTrail(tokenId, serial);
      return c.json({ events });
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to fetch audit trail";
      return errorResponse(c, 500, ErrorCodes.HCS_SUBMISSION_FAILED, message, { retryable: true });
    }
  },
);
