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
  retagDemandSignal,
  setDemandClusterLevel,
  triageDemandCluster,
} from "../lib/demand/operator-ops";
import type { DemandStore } from "../lib/demand/store";
import {
  DEMAND_CLUSTER_STATUSES,
  DEMAND_LEVELS,
} from "../lib/demand/types";
import {
  DEMAND_CATEGORY_TERMS,
  DEMAND_FEATURE_TERMS,
} from "../lib/demand/vocabulary";
import {
  rejectCtrl,
  requestFingerprint,
  runKnowledgeWrite,
} from "./admin-operator-guard";

/** Arc 231 R1: body strings reject C0/NUL like path params do
 *  (admin-operator-guard convention — raw NUL 500s the PG driver).
 *  \n\t\r stay legal inside multi-line fields. */
const noCtrl = (s: string) =>
  !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(s);

const retagSchema = z.object({
  // Arc 231 R1: retag picks FROM the dictionary — a free-form string
  // would mint dict:{junk} clusters the vocabulary never classified.
  category: z.enum(DEMAND_CATEGORY_TERMS).nullable().optional(),
  feature: z.enum(DEMAND_FEATURE_TERMS).nullable().optional(),
});

const triageSchema = z.object({
  // LINKED is not operator-targetable here — a bare link carries no
  // linkRef (M10); it arrives via the opportunity link gesture.
  to: z.enum(
    DEMAND_CLUSTER_STATUSES.filter((s) => s !== "LINKED") as unknown as [
      string,
      ...string[],
    ],
  ),
  reason: z.string().max(500).refine(noCtrl).optional(),
});

const levelSchema = z.object({
  to: z.enum(DEMAND_LEVELS),
  reason: z.string().max(500).refine(noCtrl).optional(),
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
                      : r.reason === "cluster_closed"
                        ? "target cluster is DISMISSED or LINKED — reopen it first"
                        : "no such signal",
                },
              },
            };
          }
          return { status: 200, body: { signal: r.signal, cluster: r.cluster } };
        },
        {
          owner: actor,
          // Arc 231 R1 M1: the path id is part of the fingerprint —
          // the same key+body on a different :id must not replay.
          fingerprint: requestFingerprint({
            id: c.req.param("id"),
            ...body.data,
          }),
        },
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
    "/api/admin/demand/clusters/:id/level",
    describeRoute({
      summary:
        "§16.1 VERIFIED gesture — operator level set (incl. demote; the only path to VERIFIED_DEMAND)",
      tags: ["Admin Demand"],
      responses: {
        200: { description: "Level applied" },
        400: { description: "Validation/idempotency failure" },
        404: { description: "Unknown cluster" },
        409: { description: "Level drifted since read" },
      },
    }),
    async (c) => {
      const ctrlBad = rejectCtrl(c, c.req.param("id"));
      if (ctrlBad) return ctrlBad;
      const actor = principalId(c);
      if (actor instanceof Response) return actor;
      const raw = await c.req.json().catch(() => null);
      const body = levelSchema.safeParse(raw);
      if (!body.success) {
        return errorResponse(c, 400, ErrorCodes.INVALID_INPUT, "bad level body");
      }
      return runKnowledgeWrite(
        c,
        "POST:/api/admin/demand/clusters/:id/level",
        async () => {
          const r = await setDemandClusterLevel(
            store,
            c.req.param("id"),
            body.data.to,
            actor,
          );
          if (!r.ok) {
            const missing = r.reason === "missing";
            return {
              status: missing ? 404 : 409,
              body: {
                error: {
                  code: missing ? "REQUEST_NOT_FOUND" : "ILLEGAL_LEVEL",
                  message: missing
                    ? "no such demand cluster"
                    : `level set refused (${r.reason})`,
                },
              },
            };
          }
          return { status: 200, body: { cluster: r.cluster, event: r.event } };
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