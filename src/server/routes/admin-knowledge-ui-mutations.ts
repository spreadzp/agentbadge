/**
 * EPIC-229 (SLICE-229-9): browser-form mutations for the knowledge
 * console — PRG (303 → flash) back to the page. Calls the domain
 * lib directly (228 precedent); operator label is an optional
 * `operator` field, default "admin-browser" — the JSON API remains
 * the surface with X-Operator-Id + idempotency-key.
 * Taxonomy mutations (capability/relation/evidence) live in
 * admin-knowledge-ui-mutations-taxonomy.ts (300-line file cap).
 */

import type { Hono } from "hono";

import type { KnowledgeStore } from "../lib/knowledge/store";
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
import {
  formStr,
  formRaw,
  opOf,
  opBad,
  readSeq,
  tokenConsumed,
  FORM_TOKEN_ERR,
} from "./admin-knowledge-ui-mutations-shared";

export function registerKnowledgeUiMutations(
  app: Hono,
  store: KnowledgeStore,
): void {
  app.post("/admin/knowledge/create", async (c) => {
    const b = await c.req.parseBody();
    const bad0 = rejectCtrl(c, formStr(b, "operator"));
    if (bad0) return bad0;
    if (opBad(b)) {
      return c.redirect(
        backWith("/admin/knowledge", { err: "bad_operator_ref" }),
        303,
      );
    }
    if (!tokenConsumed(b)) {
      return c.redirect(
        backWith("/admin/knowledge", { err: FORM_TOKEN_ERR }),
        303,
      );
    }
    const input = {
      kind: formStr(b, "kind") as never,
      title: formStr(b, "title"),
      body: formRaw(b, "body"),
      summary: formStr(b, "summary") || undefined,
      slug: formStr(b, "slug") || undefined,
    };
    const r = await createKnowledgeItem(store, input, opOf(b));
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
    const bad1 = rejectCtrl(c, id, formStr(b, "operator"));
    if (bad1) return bad1;
    if (opBad(b)) {
      return c.redirect(
        backWith(`/admin/knowledge/${id}`, { err: "bad_operator_ref" }),
        303,
      );
    }
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
    const r = await updateKnowledgeDraft(store, id, input, opOf(b));
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
    const bad2 = rejectCtrl(c, id, formStr(b, "operator"));
    if (bad2) return bad2;
    if (opBad(b)) {
      return c.redirect(
        backWith(`/admin/knowledge/${id}`, { err: "bad_operator_ref" }),
        303,
      );
    }
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
    const r = await transitionKnowledgeItem(store, id, to, opOf(b), null, {
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
    const bad3 = rejectCtrl(c, id, formStr(b, "operator"));
    if (bad3) return bad3;
    if (opBad(b)) {
      return c.redirect(
        backWith(`/admin/knowledge/${id}`, { err: "bad_operator_ref" }),
        303,
      );
    }
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
    const r = await restoreKnowledgeVersion(store, id, seq, opOf(b));
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
      // Arc R2 M-5: gap routes skipped opBad — an agent-shaped ref
      // could triage/resolve/wontfix through the browser surface.
      if (opBad(b)) {
        return c.redirect(
          backWith("/admin/knowledge/gaps", { err: "bad_operator_ref" }),
          303,
        );
      }
      if (!tokenConsumed(b)) {
        return c.redirect(
          backWith("/admin/knowledge/gaps", { err: FORM_TOKEN_ERR }),
          303,
        );
      }
      const actor = opOf(b);
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
}
