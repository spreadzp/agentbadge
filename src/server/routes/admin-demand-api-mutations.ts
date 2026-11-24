/**
 * EPIC-231 (SLICE-231-5, D-231-4): admin demand mutations —
 *   POST /api/admin/demand/signals/:id/retag   {category?, feature?}
 *   POST /api/admin/demand/clusters/:id/triage {to, reason?}
 *
 * Both ride the shared write path (runKnowledgeWrite): required
 * Idempotency-Key, body-fingerprint binding, no cached failures.
 * The gestures themselves live in lib/demand/operator-ops — the SSR
 * console (231-6) runs the identical sequence so event shapes can
 * never drift between surfaces.
 */

import type { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { z } from "zod";

import { principalId } from "../middleware/operatorAuth";
import { errorResponse } from "../lib/error-response";
import { ErrorCodes } from "../lib/error-codes";
import {
  createDemandOpportunity,
  retagDemandSignal,
  triageDemandCluster,
} from "../lib/demand/operator-ops";
import type { DemandStore } from "../lib/demand/store";
import { DEMAND_CLUSTER_STATUSES } from "../lib/demand/types";
import {
  rejectCtrl,
  requestFingerprint,
  runKnowledgeWrite,
} from "./admin-operator-guard";

const retagSchema = z.object({
  category: z.string().max(120).nullable().optional(),
  feature: z.string().max(120).nullable().optional(),
});

const triageSchema = z.object({
  to: z.enum(DEMAND_CLUSTER_STATUSES as unknown as [string, ...string[]]),
  reason: z.string().max(500).optional(),
});

const opportunitySchema = z.object({
  title: z.string().max(200).optional(),
  hypothesis: z.string().max(2000).nullable().optional(),
});

export function registerDemandAdminMutations(
  app: Hono,
  store: DemandStore,
): void {
  app.post(
    "/api/admin/demand/signals/:id/retag",
    describeRoute({
      summary: "Operator re-tag — re-attach signal to derived cluster + recount",
      tags: ["Admin Demand"],
      responses: {
        200: { description: "Retagged signal + new cluster" },
        400: { description: "Validation/idempotency failure" },
        404: { description: "Unknown signal" },
        409: { description: "Linked (non-canonical) row or key/body mismatch" },
      },
    }),
    async (c) => {
      const ctrlBad = rejectCtrl(c, c.req.param("id"));
      if (ctrlBad) return ctrlBad;
      const actor = principalId(c);
      if (actor instanceof Response) return actor;
      const raw = await c.req.json().catch(() => null);
      const body = retagSchema.safeParse(raw);
      if (!body.success) {
        return errorResponse(c, 400, ErrorCodes.INVALID_INPUT, "bad retag body");
      }
      return runKnowledgeWrite(
        c,
        "POST:/api/admin/demand/signals/:id/retag",
        async () => {
          const r = await retagDemandSignal(
            store,
            c.req.param("id"),
            body.data,
            actor,
          );
          if (!r.ok) {
            return {
              status: r.reason === "missing" ? 404 : 409,
              body: {
                error: {
                  code:
                    r.reason === "missing"
                      ? "REQUEST_NOT_FOUND"
                      : "LINKED_ROW",
                  message:
                    r.reason === "linked_row"
                      ? "related (non-canonical) rows cannot be retagged — retag the canonical signal"
                      : "no such signal",
                },
              },
            };
          }
          return { status: 200, body: { signal: r.signal, cluster: r.cluster } };
        },
        { owner: actor, fingerprint: requestFingerprint(body.data) },
      );
    },
  );

  app.post(
    "/api/admin/demand/clusters/:id/triage",
    describeRoute({
      summary: "Cluster status transition (OPEN→TRIAGED→LINKED|DISMISSED)",
      tags: ["Admin Demand"],
      responses: {
        200: { description: "Transitioned cluster" },
        400: { description: "Validation/idempotency failure" },
        404: { description: "Unknown cluster" },
        409: { description: "Illegal or drifted transition" },
      },
    }),
    async (c) => {
      const ctrlBad = rejectCtrl(c, c.req.param("id"));
      if (ctrlBad) return ctrlBad;
      const actor = principalId(c);
      if (actor instanceof Response) return actor;
      const raw = await c.req.json().catch(() => null);
      const body = triageSchema.safeParse(raw);
      if (!body.success) {
        return errorResponse(c, 400, ErrorCodes.INVALID_INPUT, "bad triage body");
      }
      return runKnowledgeWrite(
        c,
        "POST:/api/admin/demand/clusters/:id/triage",
        async () => {
          const r = await triageDemandCluster(
            store,
            c.req.param("id"),
            body.data.to,
            body.data.reason ?? null,
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
                    ? "no such demand cluster"
                    : `transition refused (${r.reason})`,
                },
              },
            };
          }
          return { status: 200, body: { cluster: r.cluster, event: r.event } };
        },
        { owner: actor, fingerprint: requestFingerprint(body.data) },
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
        { owner: actor, fingerprint: requestFingerprint(body.data) },
      );
    },
  );

}
