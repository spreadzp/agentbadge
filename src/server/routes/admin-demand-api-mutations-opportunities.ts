/**
 * EPIC-231 (SLICE-231-7): opportunity lifecycle mutations —
 *   POST /api/admin/demand/opportunities/:id/transition {to, reason?, patch?}
 *   POST /api/admin/demand/opportunities/:id/edit      {title?, hypothesis?, expectedValue?, declineReason?}
 *
 * Split from admin-demand-api-mutations.ts at the 300-line cap.
 * Same contract: runKnowledgeWrite (required Idempotency-Key, body
 * fingerprint, no cached errors) over lib/demand/operator-ops.
 * `to=LINKED` is refused inside the op — LINKED rows only come from
 * the «→ Backlog task» gesture so backlogTaskId is never null on one.
 */

import type { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { z } from "zod";

import { principalId } from "../middleware/operatorAuth";
import { errorResponse } from "../lib/error-response";
import { ErrorCodes } from "../lib/error-codes";
import {
  createDemandOpportunity,
  transitionDemandOpportunity,
  updateDemandOpportunity,
} from "../lib/demand/operator-ops-opportunities";
import type { DemandStore } from "../lib/demand/store";
import { DEMAND_OPPORTUNITY_STATUSES } from "../lib/demand/types";
import {
  rejectCtrl,
  requestFingerprint,
  runKnowledgeWrite,
} from "./admin-operator-guard";

/** Arc 231 R1: body strings reject C0/NUL like path params do. */
const noCtrl = (s: string) =>
  !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(s);

const opportunitySchema = z.object({
  title: z.string().max(200).refine(noCtrl).optional(),
  hypothesis: z.string().max(2000).refine(noCtrl).nullable().optional(),
});

const oppPatchSchema = z.object({
  title: z.string().min(1).max(200).refine(noCtrl).optional(),
  hypothesis: z.string().max(2000).refine(noCtrl).nullable().optional(),
  expectedValue: z.string().max(500).refine(noCtrl).nullable().optional(),
  declineReason: z.string().max(500).refine(noCtrl).nullable().optional(),
});

const oppTransitionSchema = z.object({
  to: z.enum(DEMAND_OPPORTUNITY_STATUSES as unknown as [string, ...string[]]),
  reason: z.string().max(500).refine(noCtrl).optional(),
  patch: oppPatchSchema.optional(),
});

export function registerDemandOpportunityMutations(
  app: Hono,
  store: DemandStore,
): void {
  app.post(
    "/api/admin/demand/opportunities/:id/transition",
    describeRoute({
      summary:
        "Opportunity lifecycle transition (LINKED refused — link gesture only)",
      tags: ["Admin Demand"],
      responses: {
        200: { description: "Transitioned opportunity" },
        400: { description: "Validation/idempotency failure" },
        404: { description: "Unknown opportunity" },
        409: { description: "Illegal or drifted transition" },
      },
    }),
    async (c) => {
      const ctrlBad = rejectCtrl(c, c.req.param("id"));
      if (ctrlBad) return ctrlBad;
      const actor = principalId(c);
      if (actor instanceof Response) return actor;
      const raw = await c.req.json().catch(() => null);
      const body = oppTransitionSchema.safeParse(raw);
      if (!body.success) {
        return errorResponse(
          c, 400, ErrorCodes.INVALID_INPUT, "bad transition body",
        );
      }
      return runKnowledgeWrite(
        c,
        "POST:/api/admin/demand/opportunities/:id/transition",
        async () => {
          const r = await transitionDemandOpportunity(
            store,
            c.req.param("id"),
            body.data.to,
            { reason: body.data.reason ?? null, patch: body.data.patch },
            actor,
          );
          if (!r.ok) {
            const missing = r.reason === "missing";
            return {
              status: missing ? 404 : 409,
              body: {
                error: {
                  code: missing ? "REQUEST_NOT_FOUND" : "ILLEGAL_TRANSITION",
                  message: missing
                    ? "no such opportunity"
                    : `transition refused (${r.reason})`,
                },
              },
            };
          }
          return {
            status: 200,
            body: { opportunity: r.opportunity, event: r.event },
          };
        },
        {
          owner: actor,
          fingerprint: requestFingerprint({
            id: c.req.param("id"),
            ...body.data,
          }),
        },
      );
    },
  );

  app.post(
    "/api/admin/demand/opportunities/:id/edit",
    describeRoute({
      summary: "Operator field edit — title/hypothesis/expectedValue (no status move)",
      tags: ["Admin Demand"],
      responses: {
        200: { description: "Updated opportunity" },
        400: { description: "Empty patch / validation failure" },
        404: { description: "Unknown opportunity" },
        409: { description: "Status drifted since read" },
      },
    }),
    async (c) => {
      const ctrlBad = rejectCtrl(c, c.req.param("id"));
      if (ctrlBad) return ctrlBad;
      const actor = principalId(c);
      if (actor instanceof Response) return actor;
      const raw = await c.req.json().catch(() => null);
      const body = oppPatchSchema.safeParse(raw);
      if (!body.success) {
        return errorResponse(c, 400, ErrorCodes.INVALID_INPUT, "bad edit body");
      }
      return runKnowledgeWrite(
        c,
        "POST:/api/admin/demand/opportunities/:id/edit",
        async () => {
          const r = await updateDemandOpportunity(
            store,
            c.req.param("id"),
            body.data,
            actor,
          );
          if (!r.ok) {
            const missing = r.reason === "missing";
            return {
              status: missing ? 404 : r.reason === "no_patch" ? 400 : 409,
              body: {
                error: {
                  code: missing
                    ? "REQUEST_NOT_FOUND"
                    : r.reason === "no_patch"
                      ? "EMPTY_PATCH"
                      : "STATUS_MISMATCH",
                  message:
                    r.reason === "no_patch"
                      ? "patch carries no fields"
                      : `edit refused (${r.reason})`,
                },
              },
            };
          }
          return {
            status: 200,
            body: { opportunity: r.opportunity, event: r.event },
          };
        },
        {
          owner: actor,
          fingerprint: requestFingerprint({
            id: c.req.param("id"),
            ...body.data,
          }),
        },
      );
    },
  );

  app.post(
    "/api/admin/demand/clusters/:id/opportunity",
    describeRoute({
      summary: "«→ Opportunity» — PROPOSED draft on the cluster (231-6)",
      tags: ["Admin Demand"],
      responses: {
        201: { description: "Created opportunity" },
        400: { description: "Validation/idempotency failure" },
        404: { description: "Unknown cluster" },
      },
    }),
    async (c) => {
      const ctrlBad = rejectCtrl(c, c.req.param("id"));
      if (ctrlBad) return ctrlBad;
      const actor = principalId(c);
      if (actor instanceof Response) return actor;
      const raw = await c.req.json().catch(() => ({}));
      const body = opportunitySchema.safeParse(raw ?? {});
      if (!body.success) {
        return errorResponse(
          c, 400, ErrorCodes.INVALID_INPUT, "bad opportunity body",
        );
      }
      return runKnowledgeWrite(
        c,
        "POST:/api/admin/demand/clusters/:id/opportunity",
        async () => {
          const r = await createDemandOpportunity(
            store,
            c.req.param("id"),
            body.data,
            actor,
          );
          if (!r.ok) {
            return {
              status: 404,
              body: {
                error: {
                  code: "REQUEST_NOT_FOUND",
                  message: "no such demand cluster",
                },
              },
            };
          }
          return { status: 201, body: { opportunity: r.opportunity } };
        },
        {
          owner: actor,
          fingerprint: requestFingerprint({
            id: c.req.param("id"),
            ...body.data,
          }),
        },
      );
    },
  );
}
