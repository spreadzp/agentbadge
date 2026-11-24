/**
 * EPIC-229 (SLICE-229-9): browser-form taxonomy mutations —
 * capability link/unlink, relation add/remove, evidence add/remove.
 * Split from admin-knowledge-ui-mutations.ts (300-line file cap);
 * same PRG + flash conventions, same ssrWrite idempotency.
 */

import type { Hono } from "hono";

import type { KnowledgeStore } from "../lib/knowledge/store";
import {
  addEvidence,
  addRelation,
  linkItemCapability,
  removeEvidence,
  removeRelation,
  unlinkItemCapability,
} from "../lib/knowledge";
import { backWith } from "./admin-knowledge-ui";
import { rejectCtrl } from "./admin-operator-guard";
import { principalId } from "../middleware/operatorAuth";
import {
  formStr,
  tokenConsumed,
  FORM_TOKEN_ERR,
} from "./admin-knowledge-ui-mutations-shared";

export function registerKnowledgeUiTaxonomyMutations(
  app: Hono,
  store: KnowledgeStore,
): void {
  for (const unlink of [false, true] as const) {
    app.post(
      `/admin/knowledge/:id/capability/${unlink ? "unlink" : "link"}`,
      async (c) => {
        const id = c.req.param("id") ?? "";
        const b = await c.req.parseBody();
        const bad4 = rejectCtrl(c, id, formStr(b, "capabilityId"));
        if (bad4) return bad4;
        if (!tokenConsumed(b)) {
          return c.redirect(
            backWith(`/admin/knowledge/${id}`, { err: FORM_TOKEN_ERR }),
            303,
          );
        }
        const capabilityId = formStr(b, "capabilityId");
        const r = unlink
          ? await unlinkItemCapability(store, id, capabilityId)
          : await linkItemCapability(store, id, capabilityId);
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
        const bad5 = rejectCtrl(
          c, id, formStr(b, "relationId"), formStr(b, "toItemId"),
        );
        if (bad5) return bad5;
        if (!tokenConsumed(b)) {
          return c.redirect(
            backWith(`/admin/knowledge/${id}`, { err: FORM_TOKEN_ERR }),
            303,
          );
        }
        const actor = principalId(c);
        if (actor instanceof Response) return actor;
        const r = remove
          ? await removeRelation(store, formStr(b, "relationId"), actor)
          : await addRelation(store, {
              fromItemId: id,
              toItemId: formStr(b, "toItemId"),
              type: formStr(b, "type") as never,
              actorRef: actor,
            });
        return c.redirect(
          backWith(
            `/admin/knowledge/${id}`,
            r.ok ? { ok: "edge_saved" } : { err: r.error },
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
        const bad6 = rejectCtrl(c, id, formStr(b, "evidenceId"));
        if (bad6) return bad6;
        if (!tokenConsumed(b)) {
          return c.redirect(
            backWith(`/admin/knowledge/${id}`, { err: FORM_TOKEN_ERR }),
            303,
          );
        }
        const actor = principalId(c);
        if (actor instanceof Response) return actor;
        const item = await store.getItem(id);
        const vid = item?.latestVersionId ?? "";
        // Arc R1 H4 / R2 M-11: domain guard refuses evidence writes
        // outside DRAFT; removals carry the operator for the event.
        const r = remove
          ? await removeEvidence(store, formStr(b, "evidenceId"), actor)
          : await addEvidence(store, vid, {
              type: formStr(b, "type") as never,
              uri: formStr(b, "uri"),
              label: formStr(b, "label") || null,
              addedBy: actor,
            });
        return c.redirect(
          backWith(
            `/admin/knowledge/${id}`,
            r.ok ? { ok: "evidence_saved" } : { err: r.error },
          ),
          303,
        );
      },
    );
  }
}
