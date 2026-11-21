/**
 * EPIC-228 (SLICE-228-4): admin interaction mutations —
 *   POST /api/admin/interactions/:id/classify → IN_REVIEW (INTERNAL event)
 *   POST /api/admin/interactions/:id/respond  → ANSWERED (PUBLIC event + row)
 *   POST /api/admin/interactions/:id/reject   → REJECTED (INTERNAL event)
 *
 * Split out of agent-interaction-admin-api.ts (300-line guard).
 * operatorRef comes from the X-Operator-Id header — never the body.
 * Terminal replays are honest 409s (INTERACTION_TERMINAL): the store
 * wrote nothing, the row keeps its first outcome.
 */

import type { Context, Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { z } from "zod";

import { adminAuth } from "../../middleware/adminAuth";
import { errorResponse } from "../../lib/error-response";
import { ErrorCodes } from "../../lib/error-codes";
import type { RequestInboxStores } from "../../lib/request-inbox/store";
import { statusOfState } from "../../lib/request-inbox/interaction-types";
import { classify, reject, respond } from "../../lib/agent-interaction";

const OPERATOR_MAX = 128;

/** Operator label — a header claim within the adminAuth boundary. */
export function operatorRefOf(c: Context): string {
  const raw = c.req.header("x-operator-id")?.trim();
  if (!raw) return "admin";
  return raw.slice(0, OPERATOR_MAX);
}

const classifyBodySchema = z.object({
  intent: z.string().nullish(),
  topics: z.array(z.unknown()).nullish(),
  entities: z.array(z.unknown()).nullish(),
  signalType: z.string().nullish(),
  demandSignals: z.array(z.unknown()).nullish(),
  knowledgeGap: z.boolean().optional(),
  outcome: z.string().nullish(),
});

const respondBodySchema = z.object({ body: z.string() });
const rejectBodySchema = z.object({ reason: z.string().optional() });

const notFound = (c: Context) =>
  errorResponse(c, 404, ErrorCodes.REQUEST_NOT_FOUND, "no such request");

const terminal409 = (c: Context) =>
  errorResponse(
    c,
    409,
    ErrorCodes.INTERACTION_TERMINAL,
    "request already terminal — replay refused, nothing written",
    { retryable: false },
  );

const expired410 = (c: Context) =>
  errorResponse(c, 410, ErrorCodes.REQUEST_EXPIRED, "request expired — do not retry", {
    retryable: false,
  });

export function registerInteractionMutationRoutes(
  app: Hono,
  stores: RequestInboxStores,
): void {
  app.post(
    "/api/admin/interactions/:id/classify",
    adminAuth,
    describeRoute({
      summary: "Classify an interaction — vocabulary-validated patch → IN_REVIEW",
      tags: ["Admin Interactions"],
      responses: {
        200: { description: "Applied — {id,status,transitioned}" },
        400: { description: "Vocabulary/schema violation" },
        404: { description: "Unknown id" },
      },
    }),
    async (c) => {
      const raw = await c.req.json().catch(() => null);
      const body = classifyBodySchema.safeParse(raw);
      if (!body.success) {
        return errorResponse(c, 400, ErrorCodes.INVALID_INPUT, "bad classify body");
      }
      const r = await classify(
        stores,
        c.req.param("id"),
        body.data,
        operatorRefOf(c),
      );
      if (!r.ok && r.error === "not_found") return notFound(c);
      if (!r.ok) {
        return errorResponse(c, 400, ErrorCodes.INVALID_INPUT, r.error);
      }
      return c.json({
        id: r.record.id,
        status: statusOfState(r.record.state),
        transitioned: r.transitioned,
      });
    },
  );

  app.post(
    "/api/admin/interactions/:id/respond",
    adminAuth,
    describeRoute({
      summary: "Answer an interaction — InteractionResponse + ANSWERED",
      tags: ["Admin Interactions"],
      responses: {
        200: { description: "{id,status,responseId}" },
        400: { description: "Empty/oversized body" },
        404: { description: "Unknown id" },
        409: { description: "Terminal row — replay refused, nothing written" },
      },
    }),
    async (c) => {
      const raw = await c.req.json().catch(() => null);
      const body = respondBodySchema.safeParse(raw);
      if (!body.success) {
        return errorResponse(c, 400, ErrorCodes.INVALID_INPUT, "body required");
      }
      const r = await respond(
        stores,
        c.req.param("id"),
        operatorRefOf(c),
        body.data.body,
      );
      if (!r.ok && "reason" in r) {
        return r.reason === "missing" ? notFound(c)
          : r.reason === "expired" ? expired410(c) : terminal409(c);
      }
      if (!r.ok) {
        return errorResponse(c, 400, ErrorCodes.INVALID_INPUT, r.error);
      }
      return c.json({
        id: r.record.id,
        status: statusOfState(r.record.state),
        responseId: r.responseId,
      });
    },
  );

  app.post(
    "/api/admin/interactions/:id/reject",
    adminAuth,
    describeRoute({
      summary: "Reject an interaction — REJECTED + internal event",
      tags: ["Admin Interactions"],
      responses: {
        200: { description: "{id,status}" },
        404: { description: "Unknown id" },
        409: { description: "Terminal row — replay refused" },
      },
    }),
    async (c) => {
      const raw = await c.req.json().catch(() => null);
      const body = rejectBodySchema.safeParse(raw ?? {});
      if (!body.success) {
        return errorResponse(c, 400, ErrorCodes.INVALID_INPUT, "bad reject body");
      }
      const r = await reject(
        stores,
        c.req.param("id"),
        operatorRefOf(c),
        body.data.reason,
      );
      if (!r.ok && "reason" in r) {
        return r.reason === "missing" ? notFound(c)
          : r.reason === "expired" ? expired410(c) : terminal409(c);
      }
      if (!r.ok) {
        return errorResponse(c, 400, ErrorCodes.INVALID_INPUT, r.error);
      }
      return c.json({ id: r.record.id, status: statusOfState(r.record.state) });
    },
  );
}
