/**
 * EPIC-229 (SLICE-229-3, D-229-3): admin knowledge JSON API —
 *   GET  /admin/api/knowledge/items?status=&kind=&limit=
 *   GET  /admin/api/knowledge/items/:id  (item + versions + events)
 *   POST /admin/api/knowledge/items      (create DRAFT — idempotent)
 *   POST /admin/api/knowledge/items/:id/transition — mutations file
 *
 * SLICE-264-6: operatorAuth now mounts once on the whole
 * /admin/api/knowledge/* tree — the credential resolves the
 * Principal; x-operator-id is dead at that boundary (typed 400).
 * Actor attribution = principal.id (D-264-Q4/Q16). Capability
 * gating rides capabilityForSurface: GET/HEAD→read, mutations→
 * workflow (C7). Admin reads DO see draft/pending content — the
 * published-only hard filter is the AGENT surface's contract.
 * Write endpoints require idempotency-key (contract-guards).
 */

import { Hono } from "hono";
import type { Context, MiddlewareHandler } from "hono";
import { describeRoute } from "hono-openapi";
import { z } from "zod";

import {
  capabilityForSurface,
  operatorAuth,
  principalId,
  requireCapability,
} from "../middleware/operatorAuth";
import { errorResponse } from "../lib/error-response";
import { ErrorCodes } from "../lib/error-codes";
import type { KnowledgeStore } from "../lib/knowledge/store";
import type { OperatorStore } from "../lib/operators";
import {
  createKnowledgeItem,
  KNOWLEDGE_KINDS,
  KNOWLEDGE_STATUSES,
  type CreateKnowledgeItemInput,
} from "../lib/knowledge";
import {
  rejectCtrl,
  requestFingerprint,
  runKnowledgeWrite,
} from "./admin-operator-guard";
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

/** actor = the credential-resolved principal — never request data. */
const actorId = (c: Context): string | Response => principalId(c);

export interface AdminKnowledgeDeps {
  store: KnowledgeStore;
  operatorStore: OperatorStore;
}

export function createAdminKnowledgeRoutes(
  deps: AdminKnowledgeDeps,
): Hono {
  const app = new Hono();
  const { store, operatorStore } = deps;

  // SLICE-264-6: one auth mount for the whole family. operatorAuth
  // resolves principal+operator, rejects x-operator-id (typed 400),
  // and the capability gate classifies by capabilityForSurface —
  // GET/HEAD → "read", mutations → "workflow".
  const auth = operatorAuth(operatorStore);
  const capGate: MiddlewareHandler = async (c, next) => {
    const deny = requireCapability(
      c,
      capabilityForSurface(c.req.path, c.req.method),
    );
    if (deny) return deny;
    await next();
  };
  // `path/*` covers the bare `path` in Hono 4 — a second bare mount
  // would run operatorAuth twice (double keyHash lookup, double
  // touchLastUsed, double legacy-window metric).
  app.use("/admin/api/knowledge/*", auth, capGate);

  app.get(
    "/admin/api/knowledge/items",
    describeRoute({
      summary: "Knowledge items list — operator console backing",
      tags: ["Admin Knowledge"],
      responses: { 200: { description: "Filtered item list" } },
    }),
    async (c) => {
      const status = c.req.query("status");
      const kind = c.req.query("kind");
      // "all" is a first-class filter (parity with the console) —
      // previously rejected by the enum check before reaching here.
      if (
        status !== undefined &&
        status !== "all" &&
        !KNOWLEDGE_STATUSES.includes(status as never)
      ) {
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
    describeRoute({
      summary: "Knowledge item detail — versions + status audit",
      tags: ["Admin Knowledge"],
      responses: {
        200: { description: "Item + versions + status events" },
        404: { description: "Unknown id" },
      },
    }),
    async (c) => {
      const ctrlBad = rejectCtrl(c, c.req.param("id"));
      if (ctrlBad) return ctrlBad;
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
      const actor = actorId(c);
      if (actor instanceof Response) return actor;
      const raw = await c.req.json().catch(() => null);
      const body = createBodySchema.safeParse(raw);
      if (!body.success) {
        return errorResponse(c, 400, ErrorCodes.INVALID_INPUT, "bad item body");
      }
      // Arc R1 H1: the write is bound to the canonical body — a
      // replayed key with a different title is a 409, not a silent
      // return of the first item.
      return runKnowledgeWrite(
        c,
        "POST:/admin/api/knowledge/items",
        async () => {
          const r = await createKnowledgeItem(
            store,
            body.data as CreateKnowledgeItemInput,
            actor,
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
          return {
            status: 201,
            body: { item: r.item, version: r.version },
          };
        },
        { owner: actor, fingerprint: requestFingerprint(body.data) },
      );
    },
  );

  registerKnowledgeTransitionRoutes(app, store);
  registerKnowledgeCapabilityRoutes(app, store);
  registerKnowledgeRelationRoutes(app, store);
  registerKnowledgeGapRoutes(app, store, operatorStore);

  return app;
}
