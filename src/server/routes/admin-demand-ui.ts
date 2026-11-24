/**
 * EPIC-231 (SLICE-231-6, D-231-6): operator SSR console —
 *   GET  /admin/demand              → clusters tab (top-N ×2, filters, gestures)
 *   GET  /admin/demand/signals      → internal signal feed + re-tag forms
 *   GET  /admin/demand/opportunities→ lifecycle board (read-only until 231-7)
 *   POST /admin/demand/{clusters,signals}/:id/* → PRG mutations (mutations file)
 *
 * Browser auth: `operatorBrowserAuth` Basic realm="operators" —
 * an opk_ credential resolves the Principal (SLICE-264-6/8
 * convention, same as /admin/knowledge). POSTs require same-host
 * Origin/Sec-Fetch-Site (B-3 lesson); mutations call the shared
 * lib/demand/operator-ops gestures and redirect 303 — the
 * /api/admin/demand/* JSON API stays the programmatic surface.
 */

import { Hono } from "hono";
import type { Context } from "hono";

import {
  capabilityForSurface,
  operatorBrowserAuth,
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
import { wrapFragment } from "./ui/helpers";
import { registerDemandUiMutations } from "./admin-demand-ui-mutations";
import { demandClustersPage } from "../../views/admin-demand/clusters";
import { demandOpportunitiesPage } from "../../views/admin-demand/opportunities";
import { demandSignalsPage } from "../../views/admin-demand/signals";

const page = (c: Context, frag: string, title: string): Response =>
  c.html(
    wrapFragment(c, frag, title, {
      path: c.req.path,
      title: `Admin Demand — ${title}`,
      description: `Admin Demand — ${title}`,
    }),
    200,
    { "Cache-Control": "no-store", Vary: "HX-Request" },
  );

export const backWithDemand = (
  base: string,
  flash: { ok?: string; err?: string },
): string => {
  const q = new URLSearchParams();
  if (flash.err) q.set("err", flash.err.slice(0, 120));
  else if (flash.ok) q.set("ok", flash.ok.slice(0, 120));
  const qs = q.toString();
  return `${base}${qs ? `?${qs}` : ""}`;
};

export function createAdminDemandUi(
  store: DemandStore,
  operatorStore: OperatorStore,
  deps: { backlogWriter?: () => import("../lib/demand/backlog-export").BacklogTaskWriter } = {},
): Hono {
  const app = new Hono();
  const browserAuth = operatorBrowserAuth(operatorStore);
  // `/admin/demand/*` covers the bare `/admin/demand` in Hono 4 —
  // a second bare mount would run the auth middleware twice.
  app.use("/admin/demand/*", browserAuth);
  app.use("/admin/demand/*", async (c, next) => {
    const deny = requireCapability(
      c,
      capabilityForSurface(c.req.path, c.req.method),
    );
    if (deny) return deny;
    await next();
  });
  // B-3: browsers auto-attach cached Basic creds to cross-site form
  // POSTs — Sec-Fetch-Site/Origin must say same-host when present.
  app.use("/admin/demand/*", async (c, next) => {
    if (c.req.method !== "POST") return next();
    if (c.req.header("sec-fetch-site") === "cross-site") {
      return errorResponse(
        c, 403, ErrorCodes.UNAUTHORIZED, "cross-site form post refused",
      );
    }
    const origin = c.req.header("origin");
    if (!origin) return next();
    try {
      if (new URL(origin).host === new URL(c.req.url).host) return next();
    } catch {
      /* malformed origin → reject below */
    }
    return errorResponse(
      c, 403, ErrorCodes.UNAUTHORIZED, "cross-origin form post refused",
    );
  });

  app.get("/admin/demand", async (c) => {
    const status = c.req.query("status") ?? "all";
    const level = c.req.query("level") ?? "all";
    if (status !== "all" && !DEMAND_CLUSTER_STATUSES.includes(status as never))
      return errorResponse(c, 400, ErrorCodes.INVALID_INPUT, "bad status");
    if (level !== "all" && !DEMAND_LEVELS.includes(level as never))
      return errorResponse(c, 400, ErrorCodes.INVALID_INPUT, "bad level");
    const filter = {
      status: status === "all" ? undefined : status,
      level: level === "all" ? undefined : level,
      limit: 20,
    };
    const [byCount, byActors] = await Promise.all([
      store.listClusters({ ...filter, sortBy: "count" }),
      store.listClusters({ ...filter, sortBy: "uniqueActors" }),
    ]);
    return page(
      c,
      demandClustersPage({
        byCount,
        byActors,
        status,
        level,
        flash: { ok: c.req.query("ok"), err: c.req.query("err") },
      }),
      "Clusters",
    );
  });

  app.get("/admin/demand/signals", async (c) => {
    const source = c.req.query("source") ?? "all";
    const level = c.req.query("level") ?? "all";
    if (source !== "all" && !DEMAND_SOURCES.includes(source as never))
      return errorResponse(c, 400, ErrorCodes.INVALID_INPUT, "bad source");
    if (level !== "all" && !DEMAND_LEVELS.includes(level as never))
      return errorResponse(c, 400, ErrorCodes.INVALID_INPUT, "bad level");
    const offset = Math.max(
      0, Math.min(100000, Math.floor(Number(c.req.query("offset") ?? 0)) || 0),
    );
    const rows = await store.listSignals({
      source: source === "all" ? undefined : source,
      level: level === "all" ? undefined : level,
      limit: 200,
      offset,
    });
    return page(
      c,
      demandSignalsPage({
        rows,
        source,
        level,
        flash: { ok: c.req.query("ok"), err: c.req.query("err") },
      }),
      "Signals",
    );
  });

  app.get("/admin/demand/opportunities", async (c) => {
    const status = c.req.query("status") ?? "all";
    if (
      status !== "all" &&
      !DEMAND_OPPORTUNITY_STATUSES.includes(status as never)
    )
      return errorResponse(c, 400, ErrorCodes.INVALID_INPUT, "bad status");
    const rows = await store.listOpportunities({
      status: status === "all" ? undefined : status,
      limit: 200,
    });
    return page(
      c,
      demandOpportunitiesPage({
        rows,
        status,
        flash: { ok: c.req.query("ok"), err: c.req.query("err") },
      }),
      "Opportunities",
    );
  });

  registerDemandUiMutations(app, store, deps);
  return app;
}
