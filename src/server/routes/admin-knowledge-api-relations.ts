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
import {
  idempotentWrite,
  readIdempotencyKey,
} from "../lib/contract-guards";
import type { KnowledgeStore } from "../lib/knowledge/store";
import {
  addEvidence,
  addRelation,
  itemsCiting,
  listEvidence,
  relationsFor,
  removeEvidence,
  removeRelation,
  supersededBy,
} from "../lib/knowledge";
import { requireOperatorRef } from "./admin-operator-guard";

const relationBodySchema = z.object({
  fromItemId: z.string().min(1),
  toItemId: z.string().min(1),
  type: z.string().min(1),
});
const removeRelationBodySchema = z.object({ relationId: z.string().min(1) });
const evidenceBodySchema = z.object({
  type: z.string().min(1),
  uri: z.string().min(1).max(1000),
  label: z.string().max(300).optional(),
});
const removeEvidenceBodySchema = z.object({ evidenceId: z.string().min(1) });

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
      const key = readIdempotencyKey(c);
      if (key instanceof Response) return key;
      const body = relationBodySchema.safeParse(
        await c.req.json().catch(() => null),
      );
      if (!body.success) {
        return errorResponse(c, 400, ErrorCodes.INVALID_INPUT, "bad relation body");
      }
      const actorRef = requireOperatorRef(c);
        if (actorRef instanceof Response) return actorRef;
      const res = await idempotentWrite(
        "POST:/admin/api/knowledge/relations",
        key,
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
        { owner: actorRef, resource: `${body.data.fromItemId}:${body.data.toItemId}:${body.data.type}` },
      );
      return c.json(res.body, res.status as 200);
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
      const key = readIdempotencyKey(c);
      if (key instanceof Response) return key;
      const body = removeRelationBodySchema.safeParse(
        await c.req.json().catch(() => null),
      );
      if (!body.success) {
        return errorResponse(c, 400, ErrorCodes.INVALID_INPUT, "relationId required");
      }
      const actorRef = requireOperatorRef(c);
        if (actorRef instanceof Response) return actorRef;
      const res = await idempotentWrite(
        "POST:/admin/api/knowledge/relations/remove",
        key,
        async () => {
          const r = await removeRelation(store, body.data.relationId);
          if (!r.ok) return { status: 400, body: errBody(r.error.toUpperCase()) };
          return { status: 200, body: { removed: r.removed } };
        },
        { owner: actorRef, resource: body.data.relationId },
      );
      return c.json(res.body, res.status as 200);
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
      const key = readIdempotencyKey(c);
      if (key instanceof Response) return key;
      const body = evidenceBodySchema.safeParse(
        await c.req.json().catch(() => null),
      );
      if (!body.success) {
        return errorResponse(c, 400, ErrorCodes.INVALID_INPUT, "bad evidence body");
      }
      const versionId = c.req.param("vid") ?? "";
      const actorRef = requireOperatorRef(c);
        if (actorRef instanceof Response) return actorRef;
      const res = await idempotentWrite(
        `POST:/admin/api/knowledge/versions/${versionId}/evidence`,
        key,
        async () => {
          const r = await addEvidence(store, versionId, {
            ...body.data,
            addedBy: actorRef,
          });
          if (!r.ok) {
            return {
              status: r.error === "missing_version" ? 404 : 400,
              body: errBody(r.error.toUpperCase()),
            };
          }
          return { status: 200, body: { evidence: r.evidence } };
        },
        { owner: actorRef, resource: `${versionId}:${body.data.uri}` },
      );
      return c.json(res.body, res.status as 200);
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
      const rows = await listEvidence(store, c.req.param("vid") ?? "");
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
      const key = readIdempotencyKey(c);
      if (key instanceof Response) return key;
      const body = removeEvidenceBodySchema.safeParse(
        await c.req.json().catch(() => null),
      );
      if (!body.success) {
        return errorResponse(c, 400, ErrorCodes.INVALID_INPUT, "evidenceId required");
      }
      const actorRef = requireOperatorRef(c);
        if (actorRef instanceof Response) return actorRef;
      const res = await idempotentWrite(
        "POST:/admin/api/knowledge/evidence/remove",
        key,
        async () => {
          const r = await removeEvidence(store, body.data.evidenceId);
          if (!r.ok) return { status: 400, body: errBody(r.error.toUpperCase()) };
          return { status: 200, body: { removed: r.removed } };
        },
        { owner: actorRef, resource: body.data.evidenceId },
      );
      return c.json(res.body, res.status as 200);
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
      const rows = await itemsCiting(store, uri);
      return c.json({ evidence: rows, count: rows.length });
    },
  );
}
