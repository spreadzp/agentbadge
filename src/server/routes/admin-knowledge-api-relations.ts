/**
 * EPIC-229 (SLICE-229-6): admin relation + evidence endpoints —
 *   POST   /admin/api/knowledge/relations {fromItemId, toItemId, type}
 *   POST   /admin/api/knowledge/relations/remove {relationId}
 *   GET    /admin/api/knowledge/items/:id/relations
 *   GET    /admin/api/knowledge/items/:id/superseded-by
 *   POST   /admin/api/knowledge/versions/:vid/evidence {type, uri, label?}
 *   GET    /admin/api/knowledge/versions/:vid/evidence
 *   POST   /admin/api/knowledge/evidence/remove {evidenceId}
 *   GET    /admin/api/knowledge/evidence/citing?uri=
 *
 * Split out of admin-knowledge-api.ts (300-line guard). All writes
 * require idempotency-key; operatorRef from header, never body.
 * Relation/evidence invariants (self-loop, SUPERSEDES cycle, uri
 * shape, cap-50, missing version) live in the lib — the route maps
 * {ok:false} to 400/404 honestly.
 */

import type { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { z } from "zod";

import { adminAuth } from "../middleware/adminAuth";
import { errorResponse } from "../lib/error-response";
import { ErrorCodes } from "../lib/error-codes";
import type { KnowledgeStore } from "../lib/knowledge/store";
import {
  addEvidence,
  addRelation,
  itemsCiting,
  listEvidence,
  relationsFor,
  removeEvidence,
  removeRelation,
  noCtrlStrict,
  supersededBy,
} from "../lib/knowledge";
import {
  rejectCtrl,
  requestFingerprint,
  requireOperatorRef,
  runKnowledgeWrite,
} from "./admin-operator-guard";

const idField = z
  .string()
  .min(1)
  .refine(noCtrlStrict, { message: "control characters not allowed" });
const relationBodySchema = z.object({
  fromItemId: idField,
  toItemId: idField,
  type: z.string().min(1),
});
const removeRelationBodySchema = z.object({ relationId: idField });
const evidenceBodySchema = z.object({
  type: z.string().min(1),
  uri: z.string().min(1).max(1000),
  label: z.string().max(300).optional(),
});
const removeEvidenceBodySchema = z.object({ evidenceId: idField });

const errBody = (error: string) => ({ error: { code: error, message: error } });
const statusOf = (error: string) => (error.endsWith("_item") || error === "missing_version" ? 404 : 400);

export function registerKnowledgeRelationRoutes(
  app: Hono,
  store: KnowledgeStore,
): void {
  app.post(
    "/admin/api/knowledge/relations",
    adminAuth,
    describeRoute({
      summary: "Add a typed relation edge (dedup, no self-loop/cycle)",
      tags: ["Admin Knowledge"],
      responses: {
        200: { description: "{relation, created}" },
        400: { description: "Validation/self-loop/SUPERSEDES-cycle" },
        404: { description: "Endpoint item missing" },
      },
    }),
    async (c) => {
      const actorRef = requireOperatorRef(c);
        if (actorRef instanceof Response) return actorRef;
      const body = relationBodySchema.safeParse(
        await c.req.json().catch(() => null),
      );
      if (!body.success) {
        return errorResponse(c, 400, ErrorCodes.INVALID_INPUT, "bad relation body");
      }
      return runKnowledgeWrite(
        c,
        "POST:/admin/api/knowledge/relations",
        async () => {
          const r = await addRelation(store, { ...body.data, actorRef });
          if (!r.ok) {
            return {
              status: statusOf(r.error),
              body: errBody(r.error.toUpperCase()),
            };
          }
          return { status: 200, body: { relation: r.relation, created: r.created } };
        },
        {
          owner: actorRef,
          resource: `${body.data.fromItemId}:${body.data.toItemId}:${body.data.type}`,
          fingerprint: requestFingerprint(body.data),
        },
      );
    },
  );

  app.post(
    "/admin/api/knowledge/relations/remove",
    adminAuth,
    describeRoute({
      summary: "Remove a relation edge by id",
      tags: ["Admin Knowledge"],
      responses: { 200: { description: "{removed}" } },
    }),
    async (c) => {
      const actorRef = requireOperatorRef(c);
        if (actorRef instanceof Response) return actorRef;
      const body = removeRelationBodySchema.safeParse(
        await c.req.json().catch(() => null),
      );
      if (!body.success) {
        return errorResponse(c, 400, ErrorCodes.INVALID_INPUT, "relationId required");
      }
      return runKnowledgeWrite(
        c,
        "POST:/admin/api/knowledge/relations/remove",
        async () => {
          const r = await removeRelation(store, body.data.relationId, actorRef);
          if (!r.ok) return { status: 400, body: errBody(r.error.toUpperCase()) };
          return { status: 200, body: { removed: r.removed } };
        },
        {
          owner: actorRef,
          resource: body.data.relationId,
          fingerprint: requestFingerprint(body.data),
        },
      );
    },
  );

  app.get(
    "/admin/api/knowledge/items/:id/relations",
    adminAuth,
    describeRoute({
      summary: "Relation edges for an item — both directions",
      tags: ["Admin Knowledge"],
      responses: { 200: { description: "{outgoing, incoming}" } },
    }),
    async (c) => {
      const ctrlBad = rejectCtrl(c, c.req.param("id"));
      if (ctrlBad) return ctrlBad;
      const rels = await relationsFor(store, c.req.param("id") ?? "");
      const supersedes = await supersededBy(store, c.req.param("id") ?? "");
      return c.json({ ...rels, supersededBy: supersedes });
    },
  );

  app.post(
    "/admin/api/knowledge/versions/:vid/evidence",
    adminAuth,
    describeRoute({
      summary: "Attach an evidence ref to a version (cap 50)",
      tags: ["Admin Knowledge"],
      responses: {
        200: { description: "{evidence}" },
        400: { description: "bad type/uri or cap exceeded" },
        404: { description: "Version missing" },
      },
    }),
    async (c) => {
      const versionId = c.req.param("vid") ?? "";
      const ctrlBad = rejectCtrl(c, versionId);
      if (ctrlBad) return ctrlBad;
      const actorRef = requireOperatorRef(c);
        if (actorRef instanceof Response) return actorRef;
      const body = evidenceBodySchema.safeParse(
        await c.req.json().catch(() => null),
      );
      if (!body.success) {
        return errorResponse(c, 400, ErrorCodes.INVALID_INPUT, "bad evidence body");
      }
      return runKnowledgeWrite(
        c,
        `POST:/admin/api/knowledge/versions/${versionId}/evidence`,
        async () => {
          const r = await addEvidence(store, versionId, {
            ...body.data,
            addedBy: actorRef,
          });
          if (!r.ok) {
            return {
              status:
                r.error === "missing_version" ? 404
                : r.error === "not_editable_in_status" ? 409
                : 400,
              body: errBody(r.error.toUpperCase()),
            };
          }
          return { status: 200, body: { evidence: r.evidence } };
        },
        {
          owner: actorRef,
          resource: `${versionId}:${body.data.uri}`,
          fingerprint: requestFingerprint(body.data),
        },
      );
    },
  );

  app.get(
    "/admin/api/knowledge/versions/:vid/evidence",
    adminAuth,
    describeRoute({
      summary: "Evidence refs on a version",
      tags: ["Admin Knowledge"],
      responses: { 200: { description: "{evidence[]}" } },
    }),
    async (c) => {
      const vid = c.req.param("vid") ?? "";
      const ctrlBad = rejectCtrl(c, vid);
      if (ctrlBad) return ctrlBad;
      // Parity with POST: unknown version is a 404, not an empty list.
      if ((await store.getVersion(vid)) === null) {
        return errorResponse(c, 404, ErrorCodes.RESOURCE_NOT_FOUND, "version not found");
      }
      const rows = await listEvidence(store, vid);
      return c.json({ evidence: rows, count: rows.length });
    },
  );

  app.post(
    "/admin/api/knowledge/evidence/remove",
    adminAuth,
    describeRoute({
      summary: "Remove an evidence ref by id",
      tags: ["Admin Knowledge"],
      responses: { 200: { description: "{removed}" } },
    }),
    async (c) => {
      const actorRef = requireOperatorRef(c);
        if (actorRef instanceof Response) return actorRef;
      const body = removeEvidenceBodySchema.safeParse(
        await c.req.json().catch(() => null),
      );
      if (!body.success) {
        return errorResponse(c, 400, ErrorCodes.INVALID_INPUT, "evidenceId required");
      }
      return runKnowledgeWrite(
        c,
        "POST:/admin/api/knowledge/evidence/remove",
        async () => {
          const r = await removeEvidence(store, body.data.evidenceId, actorRef);
          if (!r.ok) {
            return {
              status: r.error === "not_editable_in_status" ? 409 : 400,
              body: errBody(r.error.toUpperCase()),
            };
          }
          return { status: 200, body: { removed: r.removed } };
        },
        {
          owner: actorRef,
          resource: body.data.evidenceId,
          fingerprint: requestFingerprint(body.data),
        },
      );
    },
  );

  app.get(
    "/admin/api/knowledge/evidence/citing",
    adminAuth,
    describeRoute({
      summary: "Versions citing a uri — staleness/withdrawal lookup",
      tags: ["Admin Knowledge"],
      responses: { 200: { description: "{evidence[]}" } },
    }),
    async (c) => {
      const uri = c.req.query("uri") ?? "";
      const ctrlBad = rejectCtrl(c, uri);
      if (ctrlBad) return ctrlBad;
      const rows = await itemsCiting(store, uri);
      return c.json({ evidence: rows, count: rows.length });
    },
  );
}
