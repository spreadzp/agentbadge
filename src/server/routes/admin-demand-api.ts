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
  DEMAND_LEVEL_RANK,
  DEMAND_OPPORTUNITY_STATUSES,
  DEMAND_SOURCES,
} from "../lib/demand/types";
import type { OperatorStore } from "../lib/operators";
import { rejectCtrl } from "./admin-operator-guard";
import { registerDemandAdminMutations } from "./admin-demand-api-mutations";
import { registerDemandOpportunityMutations } from "./admin-demand-api-mutations-opportunities";

const LIST_LIMIT_MAX = 200;
const METRICS_LIMIT = 5000;

export interface AdminDemandDeps {
  store: DemandStore;
  operatorStore: OperatorStore;
}

const listLimit = (c: Context, fallback = 50): number => {
  const n = Number(c.req.query("limit") ?? String(fallback));
  return Number.isFinite(n) && n > 0
    ? Math.min(Math.floor(n), LIST_LIMIT_MAX)
    : fallback;
};

const listOffset = (c: Context): number => {
  const n = Number(c.req.query("offset") ?? "0");
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
};

const badEnum = (c: Context, name: string) =>
  errorResponse(c, 400, ErrorCodes.INVALID_INPUT, `bad ${name}`);

export function createAdminDemandRoutes(deps: AdminDemandDeps): Hono {
  const app = new Hono();
  const { store, operatorStore } = deps;

  const auth = operatorAuth(operatorStore);
  const capGate: MiddlewareHandler = async (c, next) => {
    const deny = requireCapability(
      c,
      capabilityForSurface(c.req.path, c.req.method),
    );
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
        store.listEvents("cluster", cluster.id),
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

  app.get(
    "/api/admin/demand/metrics",
    describeRoute({
      summary: "§17.4 demand digest — top asks, repeat demand, intent, conversion",
      tags: ["Admin Demand"],
      responses: { 200: { description: "Aggregated demand metrics" } },
    }),
    async (c) => {
      const [signals, clusters, opportunities] = await Promise.all([
        store.listSignals({ limit: METRICS_LIMIT }),
        store.listClusters({ limit: METRICS_LIMIT }),
        store.listOpportunities({ limit: METRICS_LIMIT }),
      ]);
      const canonical = signals.filter((s) => s.relatedSignalId === null);
      const byActors: Record<string, number> = {};
      const sessions = new Set<string>();
      let identified = 0;
      let anonymous = 0;
      for (const s of signals) {
        byActors[s.actorResolution] = (byActors[s.actorResolution] ?? 0) + 1;
        if (s.actorResolution === "ANON") anonymous += 1;
        else identified += 1;
        if (s.sessionId) sessions.add(s.sessionId);
      }
      const byStatus: Record<string, number> = {};
      const top = new Map<string, { count: number; uniqueActors: number }>();
      for (const cl of clusters) {
        byStatus[cl.status] = (byStatus[cl.status] ?? 0) + 1;
        const key = cl.capabilityKey ?? cl.clusterKey;
        const cur = top.get(key) ?? { count: 0, uniqueActors: 0 };
        top.set(key, {
          count: cur.count + cl.count,
          uniqueActors: cur.uniqueActors + cl.uniqueActors,
        });
      }
      const topCapabilities = [...top.entries()]
        .map(([key, v]) => ({ key, ...v }))
        .sort((a, b) => b.count - a.count || b.uniqueActors - a.uniqueActors)
        .slice(0, 20);
      const highIntent = clusters.filter(
        (cl) =>
          (DEMAND_LEVEL_RANK[cl.level as keyof typeof DEMAND_LEVEL_RANK] ?? 0) >=
          DEMAND_LEVEL_RANK.PURCHASE_INTENT,
      );
      return c.json({
        sampled: {
          signals: signals.length,
          clusters: clusters.length,
          opportunities: opportunities.length,
          cappedAt: METRICS_LIMIT,
        },
        requests: signals.length,
        canonicalSignals: canonical.length,
        repeatDemand: signals.length - canonical.length,
        actors: { identified, anonymous, sessions: sessions.size, byResolution: byActors },
        clusters: { total: clusters.length, byStatus },
        topCapabilities,
        highIntent: {
          purchaseIntent: highIntent.filter((cl) => cl.level === "PURCHASE_INTENT").length,
          verifiedDemand: highIntent.filter((cl) => cl.level === "VERIFIED_DEMAND").length,
        },
        demandToFeatures: {
          total: opportunities.length,
          shipped: opportunities.filter((o) => o.status === "SHIPPED").length,
          linkedToBacklog: opportunities.filter((o) => o.backlogTaskId !== null).length,
        },
      });
    },
  );

  registerDemandAdminMutations(app, store);
  registerDemandOpportunityMutations(app, store);

  return app;
}
