/**
 * EPIC-264 (SLICE-264-12): gap ownership write endpoints —
 *   POST /admin/api/knowledge/gaps/:id/assign   {assignedTo, dueAt?}
 *   POST /admin/api/knowledge/gaps/:id/unassign
 *   POST /admin/api/knowledge/gaps/:id/due      {dueAt|null, reason}
 *
 * Split out of admin-knowledge-api-gaps.ts (300-line guard). Same
 * runKnowledgeWrite idempotent path; domain refusals map through
 * statusOf/errBody — the audit event (264-11) rides the same
 * store mutation, so a refused write can't mint a ghost row.
 */

import type { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { z } from "zod";

import { errorResponse } from "../lib/error-response";
import { ErrorCodes } from "../lib/error-codes";
import { principalId } from "../middleware/operatorAuth";
import type { KnowledgeStore } from "../lib/knowledge/store";
import type { OperatorStore } from "../lib/operators/store";
import {
  assignGap,
  noCtrlStrict,
  reassignGap,
  setGapDueAt,
  unassignGap,
} from "../lib/knowledge";
import {
  rejectCtrl,
  requestFingerprint,
  runKnowledgeWrite,
} from "./admin-operator-guard";
import { errBody, statusOf } from "./admin-knowledge-api-gaps";

const assignBodySchema = z.object({
  assignedTo: z
    .string()
    .min(1)
    .refine(noCtrlStrict, { message: "control characters not allowed" }),
  dueAt: z
    .string()
    .refine(noCtrlStrict, { message: "control characters not allowed" })
    .optional(),
});

const dueBodySchema = z.object({
  dueAt: z
    .string()
    .refine(noCtrlStrict, { message: "control characters not allowed" })
    .nullable(),
  reason: z
    .string()
    .min(1)
    .refine(noCtrlStrict, { message: "control characters not allowed" }),
});

export function registerKnowledgeGapOwnershipRoutes(
  app: Hono,
  store: KnowledgeStore,
  operators: OperatorStore,
): void {
  // /assign dispatches on the row's current owner so the audit row
  // names what actually happened: "assigned" (from null/same) vs
  // "reassigned" (a different holder). A dueAt in the body on an
  // ALREADY-assigned gap is refused, not silently dropped —
  // deadlines only ever move through /due with a reason (C3).
  app.post(
    "/admin/api/knowledge/gaps/:id/assign",
    describeRoute({
      summary: "Assign or reassign a gap — {assignedTo, dueAt?}",
      tags: ["Admin Knowledge"],
      responses: {
        200: { description: "{gap}" },
        400: { description: "Bad assignee/dueAt" },
        404: { description: "Unknown gap" },
        409: { description: "Gap terminal / due change needs reason" },
      },
    }),
    async (c) => {
      const gapId = c.req.param("id") ?? "";
      const ctrlBad = rejectCtrl(c, gapId);
      if (ctrlBad) return ctrlBad;
      const actor = principalId(c);
      if (actor instanceof Response) return actor;
      const raw = await c.req.json().catch(() => null);
      const body = assignBodySchema.safeParse(raw);
      if (!body.success) {
        return errorResponse(
          c,
          400,
          ErrorCodes.INVALID_INPUT,
          "assignedTo required",
        );
      }
      return runKnowledgeWrite(
        c,
        `POST:/admin/api/knowledge/gaps/${gapId}/assign`,
        async () => {
          const gap = await store.getGap(gapId);
          if (!gap) {
            return { status: 404, body: errBody("NOT_FOUND") };
          }
          if (
            gap.assignedTo !== null &&
            body.data.dueAt !== undefined &&
            body.data.dueAt !== gap.dueAt
          ) {
            return {
              status: 409,
              body: errBody("DUE_AT_CHANGE_NEEDS_REASON"),
            };
          }
          const r =
            gap.assignedTo === null || gap.assignedTo === body.data.assignedTo
              ? await assignGap(
                  store,
                  {
                    gapId,
                    assignedTo: body.data.assignedTo,
                    assignedBy: actor,
                    dueAt: body.data.dueAt,
                  },
                  { operators },
                )
              : await reassignGap(
                  store,
                  {
                    gapId,
                    assignedTo: body.data.assignedTo,
                    assignedBy: actor,
                  },
                  { operators },
                );
          if (!r.ok) {
            return {
              status: statusOf(r.error),
              body: errBody(r.error.toUpperCase()),
            };
          }
          return { status: 200, body: { gap: r.gap } };
        },
        {
          owner: actor,
          resource: `${gapId}:assign`,
          fingerprint: requestFingerprint(body.data),
        },
      );
    },
  );

  app.post(
    "/admin/api/knowledge/gaps/:id/unassign",
    describeRoute({
      summary: "Drop a gap's assignee — deadline survives (C3)",
      tags: ["Admin Knowledge"],
      responses: {
        200: { description: "{gap}" },
        404: { description: "Unknown gap" },
      },
    }),
    async (c) => {
      const gapId = c.req.param("id") ?? "";
      const ctrlBad = rejectCtrl(c, gapId);
      if (ctrlBad) return ctrlBad;
      const actor = principalId(c);
      if (actor instanceof Response) return actor;
      return runKnowledgeWrite(
        c,
        `POST:/admin/api/knowledge/gaps/:id/unassign`,
        async () => {
          const r = await unassignGap(store, { gapId, actor });
          if (!r.ok) {
            return {
              status: statusOf(r.error),
              body: errBody(r.error.toUpperCase()),
            };
          }
          return { status: 200, body: { gap: r.gap } };
        },
        {
          owner: actor,
          resource: `${gapId}:unassign`,
          fingerprint: requestFingerprint({}),
        },
      );
    },
  );

  app.post(
    "/admin/api/knowledge/gaps/:id/due",
    describeRoute({
      summary: "Move/clear a gap's deadline — {dueAt|null, reason} (C3)",
      tags: ["Admin Knowledge"],
      responses: {
        200: { description: "{gap}" },
        400: { description: "Bad dueAt / reason required" },
        404: { description: "Unknown gap" },
      },
    }),
    async (c) => {
      const gapId = c.req.param("id") ?? "";
      const ctrlBad = rejectCtrl(c, gapId);
      if (ctrlBad) return ctrlBad;
      const actor = principalId(c);
      if (actor instanceof Response) return actor;
      const raw = await c.req.json().catch(() => null);
      const body = dueBodySchema.safeParse(raw);
      if (!body.success) {
        return errorResponse(
          c,
          400,
          ErrorCodes.INVALID_INPUT,
          "dueAt (or null) + reason required",
        );
      }
      return runKnowledgeWrite(
        c,
        `POST:/admin/api/knowledge/gaps/${gapId}/due`,
        async () => {
          const r = await setGapDueAt(store, {
            gapId,
            dueAt: body.data.dueAt,
            reason: body.data.reason,
            actor,
          });
          if (!r.ok) {
            return {
              status: statusOf(r.error),
              body: errBody(r.error.toUpperCase()),
            };
          }
          return { status: 200, body: { gap: r.gap } };
        },
        {
          owner: actor,
          resource: `${gapId}:due`,
          fingerprint: requestFingerprint(body.data),
        },
      );
    },
  );
}
