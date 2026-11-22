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
import {
  formStr,
  opOf,
  opBad,
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
        // Arc R2 M-5: capability link/unlink skipped opBad entirely.
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
          formStr(b, "operator"),
        );
        if (bad5) return bad5;
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
        const r = remove
          ? await removeRelation(store, formStr(b, "relationId"), opOf(b))
          : await addRelation(store, {
              fromItemId: id,
              toItemId: formStr(b, "toItemId"),
              type: formStr(b, "type") as never,
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
        const bad6 = rejectCtrl(
          c, id, formStr(b, "evidenceId"), formStr(b, "operator"),
        );
        if (bad6) return bad6;
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
        const item = await store.getItem(id);
        const vid = item?.latestVersionId ?? "";
        // Arc R1 H4 / R2 M-11: domain guard refuses evidence writes
        // outside DRAFT; removals carry the operator for the event.
        const r = remove
          ? await removeEvidence(store, formStr(b, "evidenceId"), opOf(b))
          : await addEvidence(store, vid, {
              type: formStr(b, "type") as never,
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
}
