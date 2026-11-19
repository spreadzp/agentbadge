/**
 * EPIC-256 (SLICE-256-3, D-256-Q14): ops QA moderation —
 *   POST /api/ops/requests/qa/:id/retract { reason }
 *
 * Split out of agent-requests-ops-api.ts for the 300-line file-size
 * guard. Retract is SOFT — the pair + reason stay in the store for
 * audit, and the route is idempotent: a repeat call returns 200 with
 * the same record (first reason/timestamp wins).
 */

import type { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { z } from "zod";

import { adminAuth } from "../../middleware/adminAuth";
import { errorResponse } from "../../lib/error-response";
import { ErrorCodes } from "../../lib/error-codes";
import type { RequestStore } from "../../lib/request-inbox/store";

const retractSchema = z.object({
  reason: z.string().min(1).max(2000),
});

export function registerQaOpsRoutes(
  app: Hono,
  requests: RequestStore,
  now: () => number,
): void {
  app.post(
    "/api/ops/requests/qa/:id/retract",
    adminAuth,
    describeRoute({
      summary: "Soft-retract a QA pair — audit kept, idempotent (D-256-Q14)",
      tags: ["Ops"],
      responses: {
        200: { description: "Pair retracted (repeat calls return the same record)" },
        400: { description: "Missing reason" },
        401: { description: "Admin key required" },
        404: { description: "Unknown qa id" },
      },
    }),
    async (c) => {
      const id = c.req.param("id");
      const parsed = retractSchema.safeParse(
        await c.req.json().catch(() => null),
      );
      if (!parsed.success) {
        return errorResponse(
          c,
          400,
          ErrorCodes.INVALID_INPUT,
          "body must be { reason: string }",
        );
      }
      const pair = await requests.retractQaPair(id, parsed.data.reason, now());
      if (!pair) {
        return errorResponse(
          c,
          404,
          ErrorCodes.REQUEST_NOT_FOUND,
          "no such qa pair",
        );
      }
      return c.json({
        qa_id: pair.id,
        retracted: true,
        retracted_at: pair.retractedAtMs,
        retract_reason: pair.retractReason,
      });
    },
  );
}
