/**
 * EPIC-229 (SLICE-229-9): browser-form mutations for the knowledge
 * console — PRG (303 → flash) back to the page. Calls the domain
 * lib directly (228 precedent); SLICE-264-6: the actor is the
 * credential-resolved principal.id — the optional `operator` form
 * field is gone; audit attribution can no longer be self-asserted.
 * Taxonomy mutations (capability/relation/evidence) live in
 * admin-knowledge-ui-mutations-taxonomy.ts (300-line file cap).
 */

import type { Hono } from "hono";

import type { KnowledgeStore } from "../lib/knowledge/store";
import type { OperatorStore } from "../lib/operators/store";
import {
  createKnowledgeItem,
  resolveGap,
  restoreKnowledgeVersion,
  transitionKnowledgeItem,
  triageGap,
  updateKnowledgeDraft,
  wontfixGap,
  KNOWLEDGE_STATUSES,
} from "../lib/knowledge";
import { backWith } from "./admin-knowledge-ui";
import { rejectCtrl } from "./admin-operator-guard";
import { principalId } from "../middleware/operatorAuth";
import {
  formStr,
  formRaw,
  readSeq,
  tokenConsumed,
  FORM_TOKEN_ERR,
} from "./admin-knowledge-ui-mutations-shared";
import { registerKnowledgeUiGapMutations } from "./admin-knowledge-ui-mutations-gaps";

/** SLICE-264-12: a datetime-local value is UTC-NAIVE — the console
 *  contract is "enter UTC" (the input is labelled so), so the form
 *  stamps the zone the domain demands rather than letting a silent
 *  local parse shift the deadline. Empty → undefined (keep). */
export const formDue = (raw: string): string | undefined =>
  raw === "" ? undefined : `${raw.length === 16 ? `${raw}:00` : raw}Z`;

export function registerKnowledgeUiMutations(
  app: Hono,
  store: KnowledgeStore,
  operators: OperatorStore,
): void {
  app.post("/admin/knowledge/create", async (c) => {
    const b = await c.req.parseBody();
    if (!tokenConsumed(b)) {
      return c.redirect(
        backWith("/admin/knowledge", { err: FORM_TOKEN_ERR }),
        303,
      );
    }
    const actor = principalId(c);
    if (actor instanceof Response) return actor;
    const input = {
      kind: formStr(b, "kind") as never,
      title: formStr(b, "title"),
      body: formRaw(b, "body"),
      summary: formStr(b, "summary") || undefined,
      slug: formStr(b, "slug") || undefined,
    };
    const r = await createKnowledgeItem(store, input, actor);
    if (!r.ok) {
      return c.redirect(backWith("/admin/knowledge", { err: r.error }), 303);
    }
    return c.redirect(
      backWith(`/admin/knowledge/${r.item.id}`, { ok: "draft_created" }),
      303,
    );
  });

  app.post("/admin/knowledge/:id/update", async (c) => {
    const id = c.req.param("id") ?? "";
    const b = await c.req.parseBody();
    const bad1 = rejectCtrl(c, id);
    if (bad1) return bad1;
    if (!tokenConsumed(b)) {
      return c.redirect(
        backWith(`/admin/knowledge/${id}`, { err: FORM_TOKEN_ERR }),
        303,
      );
    }
    // Arc R2 M-8: the edit form renders with the seq the operator
    // saw — a concurrent writer's append refuses the save honestly
    // instead of silently merging over it.
    const expectedSeq = readSeq({ seq: formStr(b, "expectedSeq") });
    const input = {
      title: formStr(b, "title") || undefined,
      body: formRaw(b, "body") || undefined,
      // empty field = explicit clear (null), parity with the JSON API
      summary: formStr(b, "summary") || null,
      expectedSeq: expectedSeq ?? undefined,
    };
    const actor = principalId(c);
    if (actor instanceof Response) return actor;
    const r = await updateKnowledgeDraft(store, id, input, actor);
    return c.redirect(
      backWith(
        `/admin/knowledge/${id}`,
        r.ok ? { ok: `saved_v${r.version.seq}` } : { err: r.error },
      ),
      303,
    );
  });

  app.post("/admin/knowledge/:id/transition", async (c) => {
    const id = c.req.param("id") ?? "";
    const b = await c.req.parseBody();
    const bad2 = rejectCtrl(c, id);
    if (bad2) return bad2;
    if (!tokenConsumed(b)) {
      return c.redirect(
        backWith(`/admin/knowledge/${id}`, { err: FORM_TOKEN_ERR }),
        303,
      );
    }
    const to = formStr(b, "to");
    if (!KNOWLEDGE_STATUSES.includes(to as never)) {
      return c.redirect(backWith(`/admin/knowledge/${id}`, { err: "bad_target" }), 303);
    }
    // Arc R2/R3 H-2: the verify/publish form carries the version +
    // evidence fingerprint the operator reviewed — re-versioned or
    // re-evidenced items refuse rather than approving unseen state.
    const expectedVersionId = formStr(b, "expectedVersionId") || undefined;
    const expectedEvidence = formStr(b, "expectedEvidence") || undefined;
    const actor = principalId(c);
    if (actor instanceof Response) return actor;
    const r = await transitionKnowledgeItem(store, id, to, actor, null, {
      expectedVersionId,
      expectedEvidence,
    });
    return c.redirect(
      backWith(
        `/admin/knowledge/${id}`,
        r.ok ? { ok: `transitioned_${to}` } : { err: r.error },
      ),
      303,
    );
  });

  app.post("/admin/knowledge/:id/restore", async (c) => {
    const id = c.req.param("id") ?? "";
    const b = await c.req.parseBody();
    const bad3 = rejectCtrl(c, id);
    if (bad3) return bad3;
    if (!tokenConsumed(b)) {
      return c.redirect(
        backWith(`/admin/knowledge/${id}`, { err: FORM_TOKEN_ERR }),
        303,
      );
    }
    const seq = readSeq(b);
    if (seq === null) {
      return c.redirect(
        backWith(`/admin/knowledge/${id}`, { err: "bad_seq" }),
        303,
      );
    }
    const actor = principalId(c);
    if (actor instanceof Response) return actor;
    const r = await restoreKnowledgeVersion(store, id, seq, actor);
    return c.redirect(
      backWith(
        `/admin/knowledge/${id}`,
        r.ok ? { ok: `restored_v${r.version.seq}` } : { err: r.error },
      ),
      303,
    );
  });

  for (const action of ["triage", "resolve", "wontfix"] as const) {
    app.post(`/admin/knowledge/gaps/:id/${action}`, async (c) => {
      const id = c.req.param("id") ?? "";
      const b = await c.req.parseBody();
      const bad7 = rejectCtrl(c, id, formStr(b, "linkedItemId"));
      if (bad7) return bad7;
      if (!tokenConsumed(b)) {
        return c.redirect(
          backWith("/admin/knowledge/gaps", { err: FORM_TOKEN_ERR }),
          303,
        );
      }
      const actor = principalId(c);
      if (actor instanceof Response) return actor;
      const r = await (action === "resolve"
        ? resolveGap(store, id, formStr(b, "linkedItemId"), actor)
        : action === "triage"
          ? triageGap(store, id, actor)
          : wontfixGap(store, id, actor));
      return c.redirect(
        backWith(
          "/admin/knowledge/gaps",
          r.ok ? { ok: `gap_${action}d` } : { err: r.error },
        ),
        303,
      );
    });
  }

  // SLICE-264-12: assign/unassign/due ownership forms — sibling
  // file (300-line cap).
  registerKnowledgeUiGapMutations(app, store, operators);
}
