/**
 * EPIC-231 (SLICE-231-5, D-231-4): admin demand mutations —
 *   POST /api/admin/demand/signals/:id/retag   {category?, feature?}
 *   POST /api/admin/demand/clusters/:id/triage {to, reason?}
 *
 * Both ride the shared write path (runKnowledgeWrite): required
 * Idempotency-Key, body-fingerprint binding, no cached failures.
 * Events travel inside the store composite calls (same-tx append);
 * hooks emit post-commit for notification seams.
 *
 * Retag re-derives the clusterKey from the FINAL category/feature
 * (normalizeClusterKey — operator tags live in the dict: namespace)
 * and re-attaches the canonical signal, recounting both clusters.
 * Linked (related) rows refuse — the operator retags canonicals.
 */

import type { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { z } from "zod";

import { principalId } from "../middleware/operatorAuth";
import { errorResponse } from "../lib/error-response";
import { ErrorCodes } from "../lib/error-codes";
import { buildDemandEvent, emitDemandHooks } from "../lib/demand/events";
import { normalizeClusterKey } from "../lib/demand/normalize";
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
          const signal = await store.getSignal(c.req.param("id"));
          if (!signal) {
            return {
              status: 404,
              body: {
                error: { code: "REQUEST_NOT_FOUND", message: "no such signal" },
              },
            };
          }
          const category =
            "category" in body.data ? body.data.category : signal.category;
          const feature =
            "feature" in body.data ? body.data.feature : signal.feature;
          const clusterKey = normalizeClusterKey(
            category ?? null,
            feature ?? null,
            signal.normalizedText,
          );
          const events = {
            signal: [
              buildDemandEvent(
                "demand.signal.retagged",
                "INTERNAL",
                {
                  signalId: signal.id,
                  from: { category: signal.category, feature: signal.feature },
                  to: { category: category ?? null, feature: feature ?? null },
                  clusterKey,
                  actor,
                },
                `retag:${signal.id}:${clusterKey}`,
              ),
            ],
            cluster: [
              buildDemandEvent("demand.cluster.updated", "INTERNAL", {
                reason: "signal_retag",
                signalId: signal.id,
                actor,
              }),
            ],
          };
          const r = await store.retagSignal(
            signal.id,
            {
              clusterKey,
              category: category ?? null,
              feature: feature ?? null,
            },
            events,
          );
          if (r.detached !== "ok") {
            return {
              status: r.detached === "missing" ? 404 : 409,
              body: {
                error: {
                  code:
                    r.detached === "missing"
                      ? "REQUEST_NOT_FOUND"
                      : "LINKED_ROW",
                  message:
                    r.detached === "linked_row"
                      ? "related (non-canonical) rows cannot be retagged — retag the canonical signal"
                      : "no such signal",
                },
              },
            };
          }
          emitDemandHooks("signal", signal.id, events.signal!);
          if (r.cluster) emitDemandHooks("cluster", r.cluster.id, events.cluster!);
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
          const cluster = await store.getCluster(c.req.param("id"));
          if (!cluster) {
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
          const event = buildDemandEvent(
            "demand.cluster.updated",
            "INTERNAL",
            {
              clusterId: cluster.id,
              from: cluster.status,
              to: body.data.to,
              actor,
              reason: body.data.reason ?? null,
            },
            `triage:${cluster.id}:${cluster.status}:${body.data.to}`,
          );
          const r = await store.transitionCluster(
            cluster.id,
            {
              from: cluster.status,
              to: body.data.to,
              actor,
              reason: body.data.reason ?? null,
            },
            event,
          );
          if (!r.transitioned) {
            const missing = r.reason === "missing";
            return {
              status: missing ? 404 : 409,
              body: {
                error: {
                  code: missing ? "REQUEST_NOT_FOUND" : "ILLEGAL_TRANSITION",
                  message: missing
                    ? "no such demand cluster"
                    : `cannot transition ${cluster.status} → ${body.data.to}`,
                },
              },
            };
          }
          emitDemandHooks("cluster", cluster.id, [event]);
          return { status: 200, body: { cluster: r.record, event: r.event } };
        },
        { owner: actor, fingerprint: requestFingerprint(body.data) },
      );
    },
  );
}
