/**
 * EPIC-229 (SLICE-229-3): admin knowledge transition mutation —
 *   POST /admin/api/knowledge/items/:id/transition  {to, reason?}
 *
 * Split out of admin-knowledge-api.ts (300-line guard).
 * operatorRef comes from the credential principal (operatorAuth) —
 * never the body; the X-Operator-Id header is dead (EPIC-264).
 * Illegal transitions are honest 409 INVALID_TRANSITION — the store
 * wrote nothing, the status/event trail stays clean. Verify/publish
 * additionally refuse agent-shaped actors (§16.5) — the lib checks
 * again below the route boundary.
 */

import type { Context, Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { z } from "zod";

import { errorResponse } from "../lib/error-response";
import { ErrorCodes } from "../lib/error-codes";
import { principalId } from "../middleware/operatorAuth";
import type { KnowledgeStore } from "../lib/knowledge/store";
import {
  allowedKnowledgeTransitions,
  KNOWLEDGE_STATUSES,
  noCtrlStrict,
  transitionKnowledgeItem,
} from "../lib/knowledge";
import {
  rejectCtrl,
  requestFingerprint,
  runKnowledgeWrite,
} from "./admin-operator-guard";

const transitionBodySchema = z.object({
  to: z.string(),
  reason: z
    .string()
    .max(2000)
    .refine(noCtrlStrict, { message: "control characters not allowed" })
    .optional(),
  /** Arc R2 H-2 + R3 M-11: stale-page precondition — REQUIRED by the
   *  store for VERIFIED/PUBLISHED (precondition_required → 400). */
  expectedVersionId: z
    .string()
    .max(80)
    .refine(noCtrlStrict, { message: "control characters not allowed" })
    .optional(),
  /** Arc R3 H-2: pins the evidence SET the caller reviewed — sorted
   *  ids joined by "|"; REQUIRED by the store for VERIFIED. */
  expectedEvidence: z
    .string()
    .max(4000)
    .refine(noCtrlStrict, { message: "control characters not allowed" })
    .optional(),
});

export function registerKnowledgeTransitionRoutes(
  app: Hono,
  store: KnowledgeStore,
): void {
  app.post(
    "/admin/api/knowledge/items/:id/transition",
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
      const itemId = c.req.param("id");
      const ctrlBad = rejectCtrl(c, itemId);
      if (ctrlBad) return ctrlBad;
      const actorRef = principalId(c);
      if (actorRef instanceof Response) return actorRef;
      const raw = await c.req.json().catch(() => null);
      const body = transitionBodySchema.safeParse(raw);
      if (!body.success) {
        return errorResponse(
          c, 400, ErrorCodes.INVALID_INPUT, "bad transition body",
        );
      }
      const to = body.data.to.toUpperCase();
      if (!KNOWLEDGE_STATUSES.includes(to as never)) {
        return errorResponse(c, 400, ErrorCodes.INVALID_INPUT, "bad status");
      }

      // Arc R1 H1: the write is bound to the canonical body — the
      // same key under {to:PENDING} can no longer replay as
      // {to:WITHDRAWN} and silently swallow the withdrawal.
      return runKnowledgeWrite(
        c,
        `POST:/admin/api/knowledge/items/${itemId}/transition`,
        async () => {
          const r = await transitionKnowledgeItem(
            store, itemId, to, actorRef, body.data.reason ?? null,
            {
              expectedVersionId: body.data.expectedVersionId,
              expectedEvidence: body.data.expectedEvidence,
            },
          );
          if (!r.ok) {
            const status =
              r.error === "not_found" ? 404
              : r.error === "precondition_required" ? 400
              : r.error === "ACTOR_NOT_OPERATOR" ||
                  r.error === "SEPARATION_OF_DUTIES" ? 403
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
        {
          owner: actorRef,
          resource: itemId,
          fingerprint: requestFingerprint(body.data),
        },
      );
    },
  );

  // Operator convenience: which transitions are legal FROM the item's
  // current status (drives the SSR button set — SSR renders only these).
  app.get(
    "/admin/api/knowledge/items/:id/transitions",
    describeRoute({
      summary: "Legal transitions for an item's current status",
      tags: ["Admin Knowledge"],
      responses: {
        200: { description: "{from, allowed[]}" },
        404: { description: "Unknown id" },
      },
    }),
    async (c: Context) => {
      const ctrlBad = rejectCtrl(c, c.req.param("id"));
      if (ctrlBad) return ctrlBad;
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
