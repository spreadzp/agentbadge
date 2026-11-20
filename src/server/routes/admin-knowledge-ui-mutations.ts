/**
 * EPIC-229 (SLICE-229-9): browser-form mutations for the knowledge
 * console — PRG (303 → flash) back to the page. Calls the domain
 * lib directly (228 precedent); operator label is an optional
 * `operator` field, default "admin-browser" — the JSON API remains
 * the surface with X-Operator-Id + idempotency-key.
 */

import type { Hono } from "hono";

import type { KnowledgeStore } from "../lib/knowledge/store";
import {
  addEvidence,
  addRelation,
  createKnowledgeItem,
  linkItemCapability,
  removeEvidence,
  removeRelation,
  resolveGap,
  restoreKnowledgeVersion,
  transitionKnowledgeItem,
  triageGap,
  unlinkItemCapability,
  updateKnowledgeDraft,
  wontfixGap,
  KNOWLEDGE_STATUSES,
} from "../lib/knowledge";
import { backWith } from "./admin-knowledge-ui";

const formStr = (b: Record<string, unknown>, k: string): string =>
  typeof b[k] === "string" ? (b[k] as string).trim() : "";

const opOf = (b: Record<string, unknown>): string =>
  formStr(b, "operator") || "admin-browser";

export function registerKnowledgeUiMutations(
  app: Hono,
  store: KnowledgeStore,
): void {
  app.post("/admin/knowledge/create", async (c) => {
    const b = await c.req.parseBody();
    const r = await createKnowledgeItem(
      store,
      {
        kind: formStr(b, "kind") as never,
        title: formStr(b, "title"),
        body: formStr(b, "body"),
        summary: formStr(b, "summary") || undefined,
        slug: formStr(b, "slug") || undefined,
      },
      opOf(b),
    );
    if (!r.ok) {
      return c.redirect(backWith("/admin/knowledge", { err: r.error }), 303);
    }
    return c.redirect(
      backWith(`/admin/knowledge/${r.item.id}`, { ok: "draft created" }),
      303,
    );
  });

  app.post("/admin/knowledge/:id/update", async (c) => {
    const id = c.req.param("id") ?? "";
    const b = await c.req.parseBody();
    const r = await updateKnowledgeDraft(
      store,
      id,
      {
        title: formStr(b, "title") || undefined,
        body: formStr(b, "body") || undefined,
        summary: formStr(b, "summary"),
      },
      opOf(b),
    );
    return c.redirect(
      backWith(
        `/admin/knowledge/${id}`,
        r.ok ? { ok: `saved v${r.version.seq}` } : { err: r.error },
      ),
      303,
    );
  });

  app.post("/admin/knowledge/:id/transition", async (c) => {
    const id = c.req.param("id") ?? "";
    const b = await c.req.parseBody();
    const to = formStr(b, "to");
    if (!KNOWLEDGE_STATUSES.includes(to as never)) {
      return c.redirect(backWith(`/admin/knowledge/${id}`, { err: "bad target" }), 303);
    }
    const r = await transitionKnowledgeItem(store, id, to, opOf(b));
    return c.redirect(
      backWith(
        `/admin/knowledge/${id}`,
        r.ok ? { ok: `→ ${to}` } : { err: r.error },
      ),
      303,
    );
  });

  app.post("/admin/knowledge/:id/restore", async (c) => {
    const id = c.req.param("id") ?? "";
    const b = await c.req.parseBody();
    const r = await restoreKnowledgeVersion(
      store,
      id,
      Number(formStr(b, "seq")),
      opOf(b),
    );
    return c.redirect(
      backWith(
        `/admin/knowledge/${id}`,
        r.ok ? { ok: `restored as v${r.version.seq}` } : { err: r.error },
      ),
      303,
    );
  });

  for (const unlink of [false, true] as const) {
    app.post(
      `/admin/knowledge/:id/capability/${unlink ? "unlink" : "link"}`,
      async (c) => {
        const id = c.req.param("id") ?? "";
        const b = await c.req.parseBody();
        const r = unlink
          ? await unlinkItemCapability(store, id, formStr(b, "capabilityId"))
          : await linkItemCapability(store, id, formStr(b, "capabilityId"));
        return c.redirect(
          backWith(
            `/admin/knowledge/${id}`,
            r.ok ? { ok: unlink ? "unlinked" : "linked" } : { err: r.error },
          ),
          303,
        );
      },
    );
  }

  for (const remove of [false, true] as const) {
    app.post(
      `/admin/knowledge/:id/relation/${remove ? "remove" : "add"}`,
      async (c) => {
        const id = c.req.param("id") ?? "";
        const b = await c.req.parseBody();
        const r = remove
          ? await removeRelation(store, formStr(b, "relationId"))
          : await addRelation(store, {
              fromItemId: id,
              toItemId: formStr(b, "toItemId"),
              type: formStr(b, "type"),
              actorRef: opOf(b),
            });
        return c.redirect(
          backWith(
            `/admin/knowledge/${id}`,
            r.ok ? { ok: "edge saved" } : { err: r.error },
          ),
          303,
        );
      },
    );
    app.post(
      `/admin/knowledge/:id/evidence/${remove ? "remove" : "add"}`,
      async (c) => {
        const id = c.req.param("id") ?? "";
        const b = await c.req.parseBody();
        const item = await store.getItem(id);
        const vid = item?.latestVersionId ?? "";
        const r = remove
          ? await removeEvidence(store, formStr(b, "evidenceId"))
          : await addEvidence(store, vid, {
              type: formStr(b, "type"),
              uri: formStr(b, "uri"),
              label: formStr(b, "label") || null,
              addedBy: opOf(b),
            });
        return c.redirect(
          backWith(
            `/admin/knowledge/${id}`,
            r.ok ? { ok: "evidence saved" } : { err: r.error },
          ),
          303,
        );
      },
    );
  }

  for (const action of ["triage", "resolve", "wontfix"] as const) {
    app.post(`/admin/knowledge/gaps/:id/${action}`, async (c) => {
      const id = c.req.param("id") ?? "";
      const b = await c.req.parseBody();
      const r =
        action === "resolve"
          ? await resolveGap(store, id, formStr(b, "linkedItemId"))
          : action === "triage"
            ? await triageGap(store, id)
            : await wontfixGap(store, id);
      return c.redirect(
        backWith(
          "/admin/knowledge/gaps",
          r.ok ? { ok: `gap ${action}d` } : { err: r.error },
        ),
        303,
      );
    });
  }
}
