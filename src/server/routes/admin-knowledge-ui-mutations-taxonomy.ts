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
  ssrWrite,
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
        const capabilityId = formStr(b, "capabilityId");
        const r = await ssrWrite(
          "capability",
          { id, capabilityId, unlink },
          async () => {
            if (unlink) {
              return unlinkItemCapability(store, id, capabilityId);
            }
            return linkItemCapability(store, id, capabilityId);
          },
        );
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
        const binding = remove
          ? { id, relationId: formStr(b, "relationId"), remove }
          : {
              id,
              toItemId: formStr(b, "toItemId"),
              type: formStr(b, "type"),
              remove,
            };
        const r = await ssrWrite("relation", binding, async () => {
          if (remove) {
            return removeRelation(store, formStr(b, "relationId"));
          }
          return addRelation(store, {
            fromItemId: id,
            toItemId: formStr(b, "toItemId"),
            type: formStr(b, "type") as never,
            actorRef: opOf(b),
          });
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
        const item = await store.getItem(id);
        const vid = item?.latestVersionId ?? "";
        // Arc R1 H4: the domain guard now refuses evidence writes on
        // PUBLISHED/WITHDRAWN versions → the flash carries the error.
        const binding = remove
          ? { id, evidenceId: formStr(b, "evidenceId"), remove }
          : {
              id,
              vid,
              type: formStr(b, "type"),
              uri: formStr(b, "uri"),
              label: formStr(b, "label"),
              remove,
            };
        const r = await ssrWrite("evidence", binding, async () => {
          if (remove) {
            return removeEvidence(store, formStr(b, "evidenceId"));
          }
          return addEvidence(store, vid, {
            type: formStr(b, "type") as never,
            uri: formStr(b, "uri"),
            label: formStr(b, "label") || null,
            addedBy: opOf(b),
          });
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
