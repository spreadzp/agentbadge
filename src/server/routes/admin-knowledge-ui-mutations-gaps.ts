/**
 * EPIC-264 (SLICE-264-12): browser-form ownership mutations for the
 * gaps console — PRG (303 → flash) back to the backlog. Same
 * dispatch as the JSON API: unassigned/same → assignGap, different
 * holder → reassignGap (the persisted audit row names what
 * happened). Split from admin-knowledge-ui-mutations.ts (300-line
 * cap). The actor is always the credential principal — `claim`
 * carries a flag, never an id.
 */

import type { Hono } from "hono";

import type { KnowledgeStore } from "../lib/knowledge/store";
import type { OperatorStore } from "../lib/operators/store";
import {
  assignGap,
  reassignGap,
  setGapDueAt,
  unassignGap,
} from "../lib/knowledge";
import { backWith } from "./admin-knowledge-ui";
import { rejectCtrl } from "./admin-operator-guard";
import { principalId } from "../middleware/operatorAuth";
import {
  formStr,
  tokenConsumed,
  FORM_TOKEN_ERR,
} from "./admin-knowledge-ui-mutations-shared";
import { formDue } from "./admin-knowledge-ui-mutations";

/** PRG target — the form's own page (`next` hidden field, detail
 *  page keeps its context); confined to /admin/knowledge/ so the
 *  field can't be tampered into an open redirect. */
export const formDest = (b: Record<string, unknown>) => {
  const next = formStr(b, "next");
  return next.startsWith("/admin/knowledge/")
    ? next
    : "/admin/knowledge/gaps";
};

export function registerKnowledgeUiGapMutations(
  app: Hono,
  store: KnowledgeStore,
  operators: OperatorStore,
): void {
  // `claim` assigns to the CREDENTIAL principal — the form never
  // supplies an actor (a hidden assignedTo=me field could be
  // tampered to another op_ id; the flag can't).
  app.post("/admin/knowledge/gaps/:id/assign", async (c) => {
    const id = c.req.param("id") ?? "";
    const b = await c.req.parseBody();
    const dest = formDest(b);
    const bad = rejectCtrl(c, id, formStr(b, "assignedTo"));
    if (bad) return bad;
    if (!tokenConsumed(b)) {
      return c.redirect(backWith(dest, { err: FORM_TOKEN_ERR }), 303);
    }
    const actor = principalId(c);
    if (actor instanceof Response) return actor;
    const assignedTo =
      formStr(b, "claim") === "1" ? actor : formStr(b, "assignedTo");
    if (assignedTo === "") {
      return c.redirect(backWith(dest, { err: "assignee_required" }), 303);
    }
    const dueAt = formDue(formStr(b, "dueAt"));
    const gap = await store.getGap(id);
    const r =
      gap !== null &&
      gap.assignedTo !== null &&
      gap.assignedTo !== assignedTo
        ? await reassignGap(
            store,
            // dueAt flows here too — the domain refuses a real
            // change (C3), confirms a matching one.
            { gapId: id, assignedTo, assignedBy: actor, dueAt },
            { operators },
          )
        : await assignGap(
            store,
            { gapId: id, assignedTo, assignedBy: actor, dueAt },
            { operators },
          );
    return c.redirect(
      backWith(dest, r.ok ? { ok: "gap_assigned" } : { err: r.error }),
      303,
    );
  });

  app.post("/admin/knowledge/gaps/:id/unassign", async (c) => {
    const id = c.req.param("id") ?? "";
    const b = await c.req.parseBody();
    const dest = formDest(b);
    const bad = rejectCtrl(c, id);
    if (bad) return bad;
    if (!tokenConsumed(b)) {
      return c.redirect(backWith(dest, { err: FORM_TOKEN_ERR }), 303);
    }
    const actor = principalId(c);
    if (actor instanceof Response) return actor;
    const r = await unassignGap(store, { gapId: id, actor });
    return c.redirect(
      backWith(dest, r.ok ? { ok: "gap_unassigned" } : { err: r.error }),
      303,
    );
  });

  app.post("/admin/knowledge/gaps/:id/due", async (c) => {
    const id = c.req.param("id") ?? "";
    const b = await c.req.parseBody();
    const dest = formDest(b);
    const bad = rejectCtrl(c, id, formStr(b, "dueAt"), formStr(b, "reason"));
    if (bad) return bad;
    if (!tokenConsumed(b)) {
      return c.redirect(backWith(dest, { err: FORM_TOKEN_ERR }), 303);
    }
    const actor = principalId(c);
    if (actor instanceof Response) return actor;
    // Blank dueAt + a reason = an explicit CLEAR — the only way a
    // deadline comes off (a cleared date isn't "no change").
    const raw = formStr(b, "dueAt");
    const r = await setGapDueAt(store, {
      gapId: id,
      dueAt: raw === "" ? null : (formDue(raw) ?? null),
      reason: formStr(b, "reason"),
      actor,
    });
    return c.redirect(
      backWith(dest, r.ok ? { ok: "gap_due_set" } : { err: r.error }),
      303,
    );
  });
}
