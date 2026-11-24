/**
 * EPIC-231 (SLICE-231-6): browser-form mutations for the demand
 * console — PRG (303 → flash). Calls the shared
 * lib/demand/operator-ops gestures so the JSON API and this surface
 * emit identical events. Single-use formToken at the edge; actor =
 * credential-resolved principal.id (never form data).
 */

import type { Hono } from "hono";

import { principalId } from "../middleware/operatorAuth";
import {
  createDemandOpportunity,
  retagDemandSignal,
  triageDemandCluster,
} from "../lib/demand/operator-ops";
import type { DemandStore } from "../lib/demand/store";
import { DEMAND_CLUSTER_STATUSES } from "../lib/demand/types";
import { rejectCtrl } from "./admin-operator-guard";
import {
  formStr,
  tokenConsumed,
  FORM_TOKEN_ERR,
} from "./admin-knowledge-ui-mutations-shared";
import { backWithDemand } from "./admin-demand-ui";

export function registerDemandUiMutations(
  app: Hono,
  store: DemandStore,
): void {
  app.post("/admin/demand/clusters/:id/triage", async (c) => {
    const id = c.req.param("id") ?? "";
    const b = await c.req.parseBody();
    const bad = rejectCtrl(c, id);
    if (bad) return bad;
    if (!tokenConsumed(b)) {
      return c.redirect(backWithDemand("/admin/demand", { err: FORM_TOKEN_ERR }), 303);
    }
    const to = formStr(b, "to");
    if (!DEMAND_CLUSTER_STATUSES.includes(to as never)) {
      return c.redirect(backWithDemand("/admin/demand", { err: "bad_target" }), 303);
    }
    const actor = principalId(c);
    if (actor instanceof Response) return actor;
    const r = await triageDemandCluster(
      store, id, to, formStr(b, "reason") || null, actor,
    );
    return c.redirect(
      backWithDemand(
        "/admin/demand",
        r.ok ? { ok: `transitioned_${to}` } : { err: r.reason },
      ),
      303,
    );
  });

  app.post("/admin/demand/clusters/:id/opportunity", async (c) => {
    const id = c.req.param("id") ?? "";
    const b = await c.req.parseBody();
    const bad = rejectCtrl(c, id);
    if (bad) return bad;
    if (!tokenConsumed(b)) {
      return c.redirect(backWithDemand("/admin/demand", { err: FORM_TOKEN_ERR }), 303);
    }
    const actor = principalId(c);
    if (actor instanceof Response) return actor;
    const r = await createDemandOpportunity(
      store,
      id,
      { title: formStr(b, "title") || undefined },
      actor,
    );
    return c.redirect(
      backWithDemand(
        "/admin/demand/opportunities",
        r.ok ? { ok: "opportunity_created" } : { err: r.reason },
      ),
      303,
    );
  });

  app.post("/admin/demand/signals/:id/retag", async (c) => {
    const id = c.req.param("id") ?? "";
    const b = await c.req.parseBody();
    const bad = rejectCtrl(c, id, formStr(b, "category"), formStr(b, "feature"));
    if (bad) return bad;
    if (!tokenConsumed(b)) {
      return c.redirect(
        backWithDemand("/admin/demand/signals", { err: FORM_TOKEN_ERR }),
        303,
      );
    }
    const actor = principalId(c);
    if (actor instanceof Response) return actor;
    const r = await retagDemandSignal(
      store,
      id,
      {
        category: formStr(b, "category") || null,
        feature: formStr(b, "feature") || null,
      },
      actor,
    );
    return c.redirect(
      backWithDemand(
        "/admin/demand/signals",
        r.ok ? { ok: "retagged" } : { err: r.reason },
      ),
      303,
    );
  });
}
