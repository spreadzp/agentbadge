/**
 * EPIC-229 (SLICE-229-3, D-229-3): admin knowledge JSON API —
 *   GET  /admin/api/knowledge/items?status=&kind=&limit=
 *   GET  /admin/api/knowledge/items/:id  (item + versions + events)
 *   POST /admin/api/knowledge/items      (create DRAFT — idempotent)
 *   POST /admin/api/knowledge/items/:id/transition — mutations file
 *
 * All behind adminAuth. operatorRef = X-Operator-Id header claim
 * (228 precedent — self-declared inside the shared-key boundary,
 * never from the body). Admin reads DO see draft/pending content —
 * the published-only hard filter is the AGENT surface's contract.
 * Write endpoints require idempotency-key (contract-guards).
 */

import { Hono } from "hono";
import type { Context } from "hono";
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
  createKnowledgeItem,
  KNOWLEDGE_KINDS,
  KNOWLEDGE_STATUSES,
  type CreateKnowledgeItemInput,
} from "../lib/knowledge";
import { requireOperatorRef } from "./admin-operator-guard";
import { registerKnowledgeTransitionRoutes } from "./admin-knowledge-api-mutations";
import { registerKnowledgeCapabilityRoutes } from "./admin-knowledge-api-capabilities";
import { registerKnowledgeRelationRoutes } from "./admin-knowledge-api-relations";
import { registerKnowledgeGapRoutes } from "./admin-knowledge-api-gaps";

const LIST_LIMIT_MAX = 200;

const createBodySchema = z.object({
  slug: z.string().optional(),
  kind: z.string(),
  title: z.string(),
  body: z.string(),
  summary: z.string().optional(),
});

const notFound = (c: Context) =>
  errorResponse(c, 404, ErrorCodes.REQUEST_NOT_FOUND, "no such knowledge item");

export interface AdminKnowledgeDeps {
  store: KnowledgeStore;
}

export function createAdminKnowledgeRoutes(
  deps: AdminKnowledgeDeps,
): Hono {
  const app = new Hono();
  const { store } = deps;

  app.get(
    "/admin/api/knowledge/items",
    adminAuth,
    describeRoute({
      summary: "Knowledge items list — operator console backing",
      tags: ["Admin Knowledge"],
      responses: { 200: { description: "Filtered item list" } },
    }),
    async (c) => {
      const status = c.req.query("status");
      const kind = c.req.query("kind");
      if (status !== undefined && !KNOWLEDGE_STATUSES.includes(status as never)) {
        return errorResponse(c, 400, ErrorCodes.INVALID_INPUT, "bad status");
      }
      if (kind !== undefined && !KNOWLEDGE_KINDS.includes(kind as never)) {
        return errorResponse(c, 400, ErrorCodes.INVALID_INPUT, "bad kind");
      }
      const limitParam = Number(c.req.query("limit") ?? "50");
      const limit =
        Number.isFinite(limitParam) && limitParam > 0
          ? Math.min(Math.floor(limitParam), LIST_LIMIT_MAX)
          : 50;
      const items = await store.listItems({
        status: status === "all" ? undefined : status,
        kind,
        limit,
      });
      return c.json({ items, count: items.length });
    },
  );

  app.get(
    "/admin/api/knowledge/items/:id",
    adminAuth,
    describeRoute({
      summary: "Knowledge item detail — versions + status audit",
      tags: ["Admin Knowledge"],
      responses: {
        200: { description: "Item + versions + status events" },
        404: { description: "Unknown id" },
      },
    }),
    async (c) => {
      const item = await store.getItem(c.req.param("id"));
      if (!item) return notFound(c);
      const [versions, events, capabilities, relations] = await Promise.all([
        store.listVersions(item.id),
        store.listStatusEvents(item.id),
        store.capabilitiesForItem(item.id),
        store.relationsFor(item.id),
      ]);
      return c.json({ item, versions, events, capabilities, relations });
    },
  );

  app.post(
    "/admin/api/knowledge/items",
    adminAuth,
    describeRoute({
      summary: "Create a knowledge item (DRAFT + version 1)",
      tags: ["Admin Knowledge"],
      responses: {
        201: { description: "Created item + first version" },
        400: { description: "Validation/idempotency-key failure" },
        409: { description: "Slug taken" },
      },
    }),
    async (c) => {
      const key = readIdempotencyKey(c);
      if (key instanceof Response) return key;
      const raw = await c.req.json().catch(() => null);
      const body = createBodySchema.safeParse(raw);
      if (!body.success) {
        return errorResponse(c, 400, ErrorCodes.INVALID_INPUT, "bad item body");
      }
      const actorRef = requireOperatorRef(c);
        if (actorRef instanceof Response) return actorRef;
      const res = await idempotentWrite(
        "POST:/admin/api/knowledge/items",
        key,
        async () => {
          const r = await createKnowledgeItem(
            store,
            body.data as CreateKnowledgeItemInput,
            actorRef,
          );
          if (!r.ok) {
            const status = r.error === "slug_taken" ? 409 : 400;
            return {
              status,
              body: {
                error: { code: r.error.toUpperCase(), message: r.error },
              },
            };
          }
          return { status: 201, body: { item: r.item, version: r.version } };
        },
        { owner: actorRef },
      );
      return c.json(res.body, res.status as 201);
    },
  );

  registerKnowledgeTransitionRoutes(app, store);
  registerKnowledgeCapabilityRoutes(app, store);
  registerKnowledgeRelationRoutes(app, store);
  registerKnowledgeGapRoutes(app, store);
  return app;
}
