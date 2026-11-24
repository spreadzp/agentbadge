/**
 * EPIC-264 (SLICE-264-4): operator credential mutations —
 *   POST /admin/api/operators/:id/credentials          issue (key ONCE)
 *   POST /admin/api/operators/:id/credentials/:cid/{revoke,rotate}
 *
 * Split out of admin-operators-api.ts (300-line guard). Same boundary:
 * operatorAuth + operator-admin capability is mounted on the prefix by
 * the parent app — these handlers only add param checks + the
 * idempotent write path.
 */

import type { Hono } from "hono";
import { describeRoute } from "hono-openapi";

import { getPrincipal } from "../middleware/operatorAuth";
import { rejectCtrl } from "./admin-operator-guard";
import {
  auditOperatorAdmin,
  credMeta,
  reasonStatus,
  runOperatorWrite,
} from "./admin-operators-shared";
import type { OperatorStore } from "../lib/operators";
import {
  issueOperatorCredential,
  rotateOperatorCredential,
} from "../lib/operators";

export function registerOperatorCredentialRoutes(
  app: Hono,
  store: OperatorStore,
): void {
  app.post(
    "/admin/api/operators/:id/credentials",
    describeRoute({
      summary: "Issue a credential — plaintext key returned ONCE",
      tags: ["Admin Operators"],
      responses: {
        200: { description: "{key, credential} — copy the key NOW" },
        404: { description: "missing_operator" },
        409: { description: "disabled_operator" },
      },
    }),
    async (c) => {
      const actor = getPrincipal(c)!;
      const id = c.req.param("id") ?? "";
      const ctrlBad = rejectCtrl(c, id);
      if (ctrlBad) return ctrlBad;
      return runOperatorWrite(
        c,
        `POST:/admin/api/operators/${id}/credentials`,
        async () => {
          const r = await issueOperatorCredential(store, id);
          if (!r.ok) {
            return {
              status: reasonStatus(r.reason),
              body: { error: { code: r.reason, message: r.reason } },
            };
          }
          auditOperatorAdmin(
            actor, "credential_issue", r.credential.id,
            { operatorId: id, keyPrefix: r.credential.keyPrefix },
          );
          return {
            status: 200,
            body: { key: r.key, credential: credMeta(r.credential) },
          };
        },
        { owner: actor.id, resource: id, body: {} },
      );
    },
  );

  app.post(
    "/admin/api/operators/:id/credentials/:cid/revoke",
    describeRoute({
      summary: "Revoke a credential (C5-guarded, idempotent)",
      tags: ["Admin Operators"],
      responses: {
        200: { description: "{credential}" },
        404: { description: "missing" },
        409: { description: "last_operator" },
      },
    }),
    async (c) => {
      const actor = getPrincipal(c)!;
      const id = c.req.param("id") ?? "";
      const cid = c.req.param("cid") ?? "";
      const ctrlBad = rejectCtrl(c, id, cid);
      if (ctrlBad) return ctrlBad;
      return runOperatorWrite(
        c,
        `POST:/admin/api/operators/${id}/credentials/${cid}/revoke`,
        async () => {
          const cred = (await store.listCredentialsForOperator(id)).find(
            (x) => x.id === cid,
          );
          if (!cred) {
            return {
              status: 404,
              body: { error: { code: "missing", message: "missing" } },
            };
          }
          const r = await store.revokeCredential(cid);
          if (!r.ok) {
            return {
              status: r.reason === "last_operator" ? 409 : 404,
              body: { error: { code: r.reason, message: r.reason } },
            };
          }
          auditOperatorAdmin(actor, "credential_revoke", cid, {
            operatorId: id,
          });
          return { status: 200, body: { credential: credMeta(r.credential) } };
        },
        { owner: actor.id, resource: `${id}/${cid}`, body: {} },
      );
    },
  );

  app.post(
    "/admin/api/operators/:id/credentials/:cid/rotate",
    describeRoute({
      summary: "Rotate — issue new BEFORE revoking old (key ONCE)",
      tags: ["Admin Operators"],
      responses: {
        200: { description: "{key, credential, revoked}" },
        404: { description: "missing_operator/missing_credential" },
        409: { description: "already_revoked" },
      },
    }),
    async (c) => {
      const actor = getPrincipal(c)!;
      const id = c.req.param("id") ?? "";
      const cid = c.req.param("cid") ?? "";
      const ctrlBad = rejectCtrl(c, id, cid);
      if (ctrlBad) return ctrlBad;
      return runOperatorWrite(
        c,
        `POST:/admin/api/operators/${id}/credentials/${cid}/rotate`,
        async () => {
          const r = await rotateOperatorCredential(store, id, cid);
          if (!r.ok) {
            return {
              status: reasonStatus(r.reason),
              body: { error: { code: r.reason, message: r.reason } },
            };
          }
          auditOperatorAdmin(actor, "credential_rotate", cid, {
            operatorId: id,
            newCredential: r.credential.id,
          });
          return {
            status: 200,
            body: {
              key: r.key,
              credential: credMeta(r.credential),
              revoked: credMeta(r.revoked),
            },
          };
        },
        { owner: actor.id, resource: `${id}/${cid}`, body: {} },
      );
    },
  );
}
