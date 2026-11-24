/**
 * EPIC-231 (SLICE-231-5, D-231-6): admin demand JSON API — operator
 * console backing for the /admin/demand screen (231-6).
 *
 *   GET  /api/admin/demand/clusters?status=&level=&sort=&limit=&offset=
 *   GET  /api/admin/demand/clusters/:id   (cluster + signals + opps + events)
 *   GET  /api/admin/demand/signals?source=&level=&clusterId=&actorRef=&canonicalOnly=
 *   POST /api/admin/demand/signals/:id/retag   — mutations file
 *   POST /api/admin/demand/clusters/:id/triage — mutations file
 *   GET  /api/admin/demand/metrics — §17.4 digest
 *
 * Auth follows the SLICE-264-6 convention: operatorAuth mounts once
 * on the whole /api/admin/demand/* tree; capabilityForSurface gives
 * GET/HEAD → "read", mutations → "workflow". Actor attribution =
 * principalId (never request data).
 *
 * D-228-8: internal fields (actorRef, dedupeKey, normalizedText) ARE
 * exposed here — this is the one surface allowed to see them; the
 * public projection never receives them.
 */

import { Hono } from "hono";
import type { Context, MiddlewareHandler } from "hono";
import { describeRoute } from "hono-openapi";

import {
  capabilityForSurface,
  operatorAuth,
  requireCapability,
} from "../middleware/operatorAuth";
import { errorResponse } from "../lib/error-response";
import { ErrorCodes } from "../lib/error-codes";
import type { DemandStore } from "../lib/demand/store";
import {
  DEMAND_CLUSTER_STATUSES,
  DEMAND_LEVELS,
  DEMAND_OPPORTUNITY_STATUSES,
  DEMAND_SOURCES,
} from "../lib/demand/types";
import type { OperatorStore } from "../lib/operators";
import { rejectCtrl } from "./admin-operator-guard";
import { registerDemandAdminMutations } from "./admin-demand-api-mutations";
import { registerDemandMetrics } from "./admin-demand-api-metrics";
import { registerDemandOpportunityMutations } from "./admin-demand-api-mutations-opportunities";
import {
  registerDemandBacklogMutation,
  type DemandBacklogRouteDeps,
} from "./admin-demand-api-mutations-backlog";

const LIST_LIMIT_MAX = 200;
const OFFSET_MAX = 100_000;
const EVENTS_LIMIT = 500;

export interface AdminDemandDeps {
  store: DemandStore;
  operatorStore: OperatorStore;
  /** 231-8: «→ Backlog task» writer factory (default: FS/env). */
  backlogWriter?: DemandBacklogRouteDeps["backlogWriter"];
}

const listLimit = (c: Context, fallback = 50): number => {
  const n = Number(c.req.query("limit") ?? String(fallback));
  return Number.isFinite(n) && n > 0
    ? Math.min(Math.floor(n), LIST_LIMIT_MAX)
    : fallback;
};

const listOffset = (c: Context): number => {
  const n = Number(c.req.query("offset") ?? "0");
  return Number.isFinite(n) && n > 0
    ? Math.min(Math.floor(n), OFFSET_MAX)
    : 0;
};

const badEnum = (c: Context, name: string) =>
  errorResponse(c, 400, ErrorCodes.INVALID_INPUT, `bad ${name}`);

export function createAdminDemandRoutes(deps: AdminDemandDeps): Hono {
  const app = new Hono();
  const { store, operatorStore } = deps;

  const auth = operatorAuth(operatorStore);
  const capGate: MiddlewareHandler = async (c, next) => {
    // Arc 231 R1 M12: the signals feed and cluster detail expose
    // actorRef (raw IP), sessionId, dedupeKey and verbatim context —
    // workflow-gated, matching the sibling interactions surface.
    const path = c.req.path;
    const cap =
      c.req.method !== "GET" && c.req.method !== "HEAD"
        ? "workflow"
        : path.includes("/signals") || /\/clusters\/[^/]+$/.test(path)
          ? "workflow"
          : capabilityForSurface(path, c.req.method);
    const deny = requireCapability(c, cap);
    if (deny) return deny;
    await next();
  };
  app.use("/api/admin/demand/*", auth, capGate);

  app.get(
    "/api/admin/demand/clusters",
    describeRoute({
      summary: "Demand clusters — top-N board (count|uniqueActors|lastSeenAt)",
      tags: ["Admin Demand"],
      responses: { 200: { description: "Filtered cluster list" } },
    }),
    async (c) => {
      const status = c.req.query("status");
      const level = c.req.query("level");
      const sort = c.req.query("sort") ?? "count";
      if (status !== undefined && !DEMAND_CLUSTER_STATUSES.includes(status as never))
        return badEnum(c, "status");
      if (level !== undefined && !DEMAND_LEVELS.includes(level as never))
        return badEnum(c, "level");
      if (!["count", "uniqueActors", "lastSeenAt"].includes(sort))
        return badEnum(c, "sort");
      const items = await store.listClusters({
        status,
        level,
        sortBy: sort as "count" | "uniqueActors" | "lastSeenAt",
        limit: listLimit(c),
        offset: listOffset(c),
      });
      return c.json({ items, count: items.length });
    },
  );

  app.get(
    "/api/admin/demand/clusters/:id",
    describeRoute({
      summary: "Cluster detail — attached canonical signals + opps + event audit",
      tags: ["Admin Demand"],
      responses: {
        200: { description: "Cluster + signals + opportunities + events" },
        404: { description: "Unknown id" },
      },
    }),
    async (c) => {
      const ctrlBad = rejectCtrl(c, c.req.param("id"));
      if (ctrlBad) return ctrlBad;
      const cluster = await store.getCluster(c.req.param("id"));
      if (!cluster) {
        return errorResponse(
          c, 404, ErrorCodes.REQUEST_NOT_FOUND, "no such demand cluster",
        );
      }
      const [signals, opportunities, events] = await Promise.all([
        store.listSignals({ clusterId: cluster.id, limit: LIST_LIMIT_MAX }),
        store.listOpportunities({ clusterId: cluster.id, limit: LIST_LIMIT_MAX }),
        store.listEvents("cluster", cluster.id, { limit: EVENTS_LIMIT }),
      ]);
      return c.json({ cluster, signals, opportunities, events });
    },
  );

  app.get(
    "/api/admin/demand/signals",
    describeRoute({
      summary: "Demand signals — internal feed (actorRef visible here only)",
      tags: ["Admin Demand"],
      responses: { 200: { description: "Filtered signal list" } },
    }),
    async (c) => {
      const source = c.req.query("source");
      const level = c.req.query("level");
      if (source !== undefined && !DEMAND_SOURCES.includes(source as never))
        return badEnum(c, "source");
      if (level !== undefined && !DEMAND_LEVELS.includes(level as never))
        return badEnum(c, "level");
      const canonicalOnly = ["1", "true"].includes(
        c.req.query("canonicalOnly") ?? "",
      );
      const items = await store.listSignals({
        source,
        level,
        clusterId: c.req.query("clusterId"),
        actorRef: c.req.query("actorRef"),
        canonicalOnly: canonicalOnly || undefined,
        limit: listLimit(c),
        offset: listOffset(c),
      });
      return c.json({ items, count: items.length });
    },
  );

  app.get(
    "/api/admin/demand/opportunities",
    describeRoute({
      summary: "Opportunities — lifecycle board (status/clusterId filters)",
      tags: ["Admin Demand"],
      responses: { 200: { description: "Filtered opportunity list" } },
    }),
    async (c) => {
      const status = c.req.query("status");
      if (
        status !== undefined &&
        !DEMAND_OPPORTUNITY_STATUSES.includes(status as never)
      )
        return badEnum(c, "status");
      const items = await store.listOpportunities({
        status,
        clusterId: c.req.query("clusterId"),
        limit: listLimit(c),
        offset: listOffset(c),
      });
      return c.json({ items, count: items.length });
    },
  );

  registerDemandMetrics(app, store);
  registerDemandAdminMutations(app, store);
  registerDemandOpportunityMutations(app, store);
  registerDemandBacklogMutation(app, store, {
    backlogWriter: deps.backlogWriter,
  });

  return app;
}
