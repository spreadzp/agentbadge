/**
 * EPIC-231 (SLICE-231-6): browser-form mutations for the demand
 * console — PRG (303 → flash). Calls the shared
 * lib/demand/operator-ops gestures so the JSON API and this surface
 * emit identical events. Single-use formToken at the edge; actor =
 * credential-resolved principal.id (never form data).
 */

import type { Context, Hono } from "hono";

import { principalId } from "../middleware/operatorAuth";
import {
  createDemandOpportunity,
  transitionDemandOpportunity,
  updateDemandOpportunity,
} from "../lib/demand/operator-ops-opportunities";
import {
  retagDemandSignal,
  setDemandClusterLevel,
  triageDemandCluster,
} from "../lib/demand/operator-ops";
import {
  defaultBacklogWriter,
  linkDemandBacklog,
  type BacklogTaskWriter,
} from "../lib/demand/backlog-export";
import type { DemandStore } from "../lib/demand/store";
import type { DemandLevel } from "../lib/demand/types";
import {
  DEMAND_CLUSTER_STATUSES,
  DEMAND_LEVELS,
  DEMAND_OPPORTUNITY_STATUSES,
} from "../lib/demand/types";
import {
  DEMAND_CATEGORY_TERMS,
  DEMAND_FEATURE_TERMS,
} from "../lib/demand/vocabulary";
import { rejectCtrl } from "./admin-operator-guard";
import {
  formStr,
  tokenConsumed,
  FORM_TOKEN_ERR,
} from "./admin-knowledge-ui-mutations-shared";
import { backWithDemand } from "./admin-demand-ui";

/** Arc 231 R2 L-3: the three pre-write checks every mutation
 *  shares — NUL/C0 reject on id + text fields, JSON-parity length
 *  caps, single-use formToken. Returns the response to send, or
 *  null when the write may proceed. */
const formGuard = (
  c: Context,
  dest: string,
  id: string,
  b: Record<string, unknown>,
  fields: string[] = [],
  caps: [string, number][] = [],
): Response | null => {
  const bad = rejectCtrl(c, id, ...fields.map((f) => formStr(b, f)));
  if (bad) return bad;
  if (caps.some(([name, max]) => formStr(b, name).length > max)) {
    return c.redirect(backWithDemand(dest, { err: "field_too_long" }), 303);
  }
  if (!tokenConsumed(b)) {
    return c.redirect(backWithDemand(dest, { err: FORM_TOKEN_ERR }), 303);
  }
  return null;
};

export function registerDemandUiMutations(
  app: Hono,
  store: DemandStore,
  deps: { backlogWriter?: () => BacklogTaskWriter } = {},
): void {
  app.post("/admin/demand/clusters/:id/triage", async (c) => {
    const id = c.req.param("id") ?? "";
    const b = await c.req.parseBody();
    const guard = formGuard(
      c, "/admin/demand", id, b, ["reason"], [["reason", 500]],
    );
    if (guard) return guard;
    const to = formStr(b, "to");
    // LINKED is not operator-targetable — a bare link carries no
    // linkRef (Arc 231 R1 M10).
    if (
      !DEMAND_CLUSTER_STATUSES.includes(to as never) ||
      to === "LINKED"
    ) {
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
    const guard = formGuard(
      c, "/admin/demand/opportunities", id, b, ["title"], [["title", 200]],
    );
    if (guard) return guard;
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

  // §16.1 VERIFIED gesture — the operator's explicit level set;
  // the only path a cluster ever reaches VERIFIED_DEMAND.
  app.post("/admin/demand/clusters/:id/level", async (c) => {
    const id = c.req.param("id") ?? "";
    const b = await c.req.parseBody();
    const guard = formGuard(
      c, "/admin/demand", id, b, ["reason"], [["reason", 500]],
    );
    if (guard) return guard;
    const to = formStr(b, "to");
    if (!DEMAND_LEVELS.includes(to as DemandLevel)) {
      return c.redirect(backWithDemand("/admin/demand", { err: "bad_target" }), 303);
    }
    const actor = principalId(c);
    if (actor instanceof Response) return actor;
    const r = await setDemandClusterLevel(
      store, id, to as DemandLevel, actor, formStr(b, "reason") || null,
    );
    return c.redirect(
      backWithDemand(
        "/admin/demand",
        r.ok ? { ok: `level_${to}` } : { err: r.reason },
      ),
      303,
    );
  });

  app.post("/admin/demand/opportunities/:id/transition", async (c) => {
    const id = c.req.param("id") ?? "";
    const b = await c.req.parseBody();
    const guard = formGuard(
      c, "/admin/demand/opportunities", id, b,
      ["declineReason", "reason"],
      [["declineReason", 500], ["reason", 500]],
    );
    if (guard) return guard;
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
    const guard = formGuard(
      c, "/admin/demand/opportunities", id, b,
      ["title", "hypothesis", "expectedValue"],
      [["title", 200], ["hypothesis", 2000], ["expectedValue", 500]],
    );
    if (guard) return guard;
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
    const guard = formGuard(c, "/admin/demand/opportunities", id, b);
    if (guard) return guard;
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
    const guard = formGuard(
      c, "/admin/demand/signals", id, b, ["category", "feature"],
    );
    if (guard) return guard;
    const category = formStr(b, "category") || null;
    const feature = formStr(b, "feature") || null;
    // Arc 231 R1: retag picks FROM the dictionary — free-form
    // strings mint dict:{junk} clusters.
    if (
      (category !== null && !DEMAND_CATEGORY_TERMS.includes(category as never)) ||
      (feature !== null && !DEMAND_FEATURE_TERMS.includes(feature as never))
    ) {
      return c.redirect(
        backWithDemand("/admin/demand/signals", { err: "bad_target" }),
        303,
      );
    }
    const actor = principalId(c);
    if (actor instanceof Response) return actor;
    const r = await retagDemandSignal(store, id, { category, feature }, actor);
    return c.redirect(
      backWithDemand(
        "/admin/demand/signals",
        r.ok ? { ok: "retagged" } : { err: r.reason },
      ),
      303,
    );
  });
}
