/**
 * EPIC-229 (SLICE-229-3): admin knowledge transition mutation —
 *   POST /admin/api/knowledge/items/:id/transition  {to, reason?}
 *
 * Split out of admin-knowledge-api.ts (300-line guard).
 * operatorRef comes from the X-Operator-Id header — never the body.
 * Illegal transitions are honest 409 INVALID_TRANSITION — the store
 * wrote nothing, the status/event trail stays clean. Verify/publish
 * additionally refuse agent-shaped actors (§16.5) — the lib checks
 * again below the route boundary.
 */

import type { Context, Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { z } from "zod";

import { adminAuth } from "../middleware/adminAuth";
import { errorResponse } from "../lib/error-response";
import { ErrorCodes } from "../lib/error-codes";
import {
  idempotentWrite,
  readIdempotencyKey,
} from "../lib/contract-guards";
import type { KnowledgeStore } from "../lib/knowledge/store";
import {
  allowedKnowledgeTransitions,
  KNOWLEDGE_STATUSES,
  transitionKnowledgeItem,
} from "../lib/knowledge";
import { requireOperatorRef } from "./admin-operator-guard";

const transitionBodySchema = z.object({
  to: z.string(),
  reason: z.string().max(2000).optional(),
});

export function registerKnowledgeTransitionRoutes(
  app: Hono,
  store: KnowledgeStore,
): void {
  app.post(
    "/admin/api/knowledge/items/:id/transition",
    adminAuth,
    describeRoute({
      summary: "Transition a knowledge item through the approval machine",
      tags: ["Admin Knowledge"],
      responses: {
        200: { description: "Applied — {item,event}" },
        400: { description: "Validation/idempotency-key failure" },
        403: { description: "Agent actor attempted verify/publish" },
        404: { description: "Unknown id" },
        409: { description: "INVALID_TRANSITION" },
      },
    }),
    async (c) => {
      const key = readIdempotencyKey(c);
      if (key instanceof Response) return key;
      const raw = await c.req.json().catch(() => null);
      const body = transitionBodySchema.safeParse(raw);
      if (!body.success) {
        return errorResponse(
          c, 400, ErrorCodes.INVALID_INPUT, "bad transition body",
        );
      }
      const itemId = c.req.param("id");
      const to = body.data.to.toUpperCase();
      if (!KNOWLEDGE_STATUSES.includes(to as never)) {
        return errorResponse(c, 400, ErrorCodes.INVALID_INPUT, "bad status");
      }
      const actorRef = requireOperatorRef(c);
        if (actorRef instanceof Response) return actorRef;

      try {
        const res = await idempotentWrite(
          `POST:/admin/api/knowledge/items/${itemId}/transition`,
          key,
          async () => {
            const r = await transitionKnowledgeItem(
              store, itemId, to, actorRef, body.data.reason ?? null,
            );
            if (!r.ok) {
              const status =
                r.error === "not_found" ? 404
                : r.error === "ACTOR_NOT_OPERATOR" ? 403
                : 409;
              return {
                status,
                body: {
                  error: {
                    code:
                      r.error === "not_found" ? "NOT_FOUND" : r.error,
                    message: r.error,
                    ...(r.field ? { detail: r.field } : {}),
                  },
                },
              };
            }
            return { status: 200, body: { item: r.item, event: r.event } };
          },
          { owner: actorRef, resource: itemId },
        );
        return c.json(res.body, res.status as 200);
      } catch (err) {
        if (err instanceof Error && err.name === "IdempotencyConflictError") {
          return errorResponse(
            c, 409, ErrorCodes.CONFLICT,
            "idempotency key reused with a different request body",
          );
        }
        throw err;
      }
    },
  );

  // Operator convenience: which transitions are legal FROM the item's
  // current status (drives the SSR button set — SSR renders only these).
  app.get(
    "/admin/api/knowledge/items/:id/transitions",
    adminAuth,
    describeRoute({
      summary: "Legal transitions for an item's current status",
      tags: ["Admin Knowledge"],
      responses: {
        200: { description: "{from, allowed[]}" },
        404: { description: "Unknown id" },
      },
    }),
    async (c: Context) => {
      const item = await store.getItem(c.req.param("id") ?? "");
      if (!item) {
        return errorResponse(
          c, 404, ErrorCodes.REQUEST_NOT_FOUND, "no such knowledge item",
        );
      }
      return c.json({
        from: item.status,
        allowed: [...allowedKnowledgeTransitions(item.status)],
      });
    },
  );
}
