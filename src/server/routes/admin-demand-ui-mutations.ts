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
  transitionDemandOpportunity,
  triageDemandCluster,
  updateDemandOpportunity,
} from "../lib/demand/operator-ops";
import {
  defaultBacklogWriter,
  linkDemandBacklog,
  type BacklogTaskWriter,
} from "../lib/demand/backlog-export";
import type { DemandStore } from "../lib/demand/store";
import {
  DEMAND_CLUSTER_STATUSES,
  DEMAND_OPPORTUNITY_STATUSES,
} from "../lib/demand/types";
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
  deps: { backlogWriter?: () => BacklogTaskWriter } = {},
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

  app.post("/admin/demand/opportunities/:id/transition", async (c) => {
    const id = c.req.param("id") ?? "";
    const b = await c.req.parseBody();
    const bad = rejectCtrl(c, id, formStr(b, "declineReason"));
    if (bad) return bad;
    if (!tokenConsumed(b)) {
      return c.redirect(
        backWithDemand("/admin/demand/opportunities", { err: FORM_TOKEN_ERR }),
        303,
      );
    }
    const to = formStr(b, "to");
    if (!DEMAND_OPPORTUNITY_STATUSES.includes(to as never)) {
      return c.redirect(
        backWithDemand("/admin/demand/opportunities", { err: "bad_target" }),
        303,
      );
    }
    const actor = principalId(c);
    if (actor instanceof Response) return actor;
    const declineReason = formStr(b, "declineReason") || null;
    const r = await transitionDemandOpportunity(
      store,
      id,
      to,
      {
        reason: formStr(b, "reason") || declineReason,
        patch: declineReason ? { declineReason } : undefined,
      },
      actor,
    );
    return c.redirect(
      backWithDemand(
        "/admin/demand/opportunities",
        r.ok ? { ok: `transitioned_${to}` } : { err: r.reason },
      ),
      303,
    );
  });

  app.post("/admin/demand/opportunities/:id/edit", async (c) => {
    const id = c.req.param("id") ?? "";
    const b = await c.req.parseBody();
    const bad = rejectCtrl(c, id);
    if (bad) return bad;
    if (!tokenConsumed(b)) {
      return c.redirect(
        backWithDemand("/admin/demand/opportunities", { err: FORM_TOKEN_ERR }),
        303,
      );
    }
    const actor = principalId(c);
    if (actor instanceof Response) return actor;
    // The edit form always renders all three fields — empty = clear
    // (null), parity with the knowledge update convention.
    const r = await updateDemandOpportunity(
      store,
      id,
      {
        title: formStr(b, "title") || undefined,
        hypothesis: formStr(b, "hypothesis") || null,
        expectedValue: formStr(b, "expectedValue") || null,
      },
      actor,
    );
    return c.redirect(
      backWithDemand(
        "/admin/demand/opportunities",
        r.ok ? { ok: "saved" } : { err: r.reason },
      ),
      303,
    );
  });

  app.post("/admin/demand/opportunities/:id/backlog", async (c) => {
    const id = c.req.param("id") ?? "";
    const b = await c.req.parseBody();
    const bad = rejectCtrl(c, id);
    if (bad) return bad;
    if (!tokenConsumed(b)) {
      return c.redirect(
        backWithDemand("/admin/demand/opportunities", { err: FORM_TOKEN_ERR }),
        303,
      );
    }
    const actor = principalId(c);
    if (actor instanceof Response) return actor;
    const writer = deps.backlogWriter ?? defaultBacklogWriter;
    const r = await linkDemandBacklog(store, id, actor, { writer: writer() });
    return c.redirect(
      backWithDemand(
        "/admin/demand/opportunities",
        r.ok ? { ok: `linked_${r.taskId}` } : { err: r.reason },
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
