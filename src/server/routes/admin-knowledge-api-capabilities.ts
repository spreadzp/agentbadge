/**
 * EPIC-229 (SLICE-229-4): admin capability endpoints —
 *   GET  /admin/api/knowledge/capabilities?verified=&kind=
 *   POST /admin/api/knowledge/capabilities        (MANUAL, verified:false)
 *   POST /admin/api/knowledge/items/:id/capabilities    {capabilityId}  link
 *   POST /admin/api/knowledge/items/:id/capabilities/unlink {capabilityId}
 *
 * Split out of admin-knowledge-api.ts (300-line guard). All writes
 * require idempotency-key; operatorRef from header, never body.
 */

import type { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { z } from "zod";

import { errorResponse } from "../lib/error-response";
import { ErrorCodes } from "../lib/error-codes";
import { getPrincipal } from "../middleware/operatorAuth";
import type { KnowledgeStore } from "../lib/knowledge/store";
import {
  linkItemCapability,
  listKnowledgeCapabilities,
  unlinkItemCapability,
  upsertKnowledgeCapability,
  KNOWLEDGE_CAPABILITY_KINDS,
  noCtrlStrict,
} from "../lib/knowledge";
import {
  rejectCtrl,
  requestFingerprint,
  runKnowledgeWrite,
} from "./admin-operator-guard";

const capBodySchema = z.object({
  name: z
    .string()
    .min(1)
    .max(200)
    // Arc R4 M-7: single-line fields get the strict predicate — a
    // bidi mark or newline in a capability name forges console UI.
    .refine(noCtrlStrict, { message: "control characters not allowed" }),
  kind: z.string(),
  description: z
    .string()
    .max(2000)
    .refine(noCtrlStrict, { message: "control characters not allowed" })
    .optional(),
});

const linkBodySchema = z.object({
  capabilityId: z
    .string()
    .min(1)
    .refine(noCtrlStrict, { message: "control characters not allowed" }),
});

const errBody = (error: string) => ({ error: { code: error, message: error } });

export function registerKnowledgeCapabilityRoutes(
  app: Hono,
  store: KnowledgeStore,
): void {
  app.get(
    "/admin/api/knowledge/capabilities",
    describeRoute({
      summary: "List capability registry entries",
      tags: ["Admin Knowledge"],
      responses: { 200: { description: "Filtered capability list" } },
    }),
    async (c) => {
      const verified = c.req.query("verified");
      const kind = c.req.query("kind");
      if (kind !== undefined && !KNOWLEDGE_CAPABILITY_KINDS.includes(kind as never)) {
        return errorResponse(c, 400, ErrorCodes.INVALID_INPUT, "bad kind");
      }
      const rows = await listKnowledgeCapabilities(store, {
        verified:
          verified === "true" ? true
          : verified === "false" ? false
          : undefined,
        kind,
      });
      return c.json({ capabilities: rows, count: rows.length });
    },
  );

  app.post(
    "/admin/api/knowledge/capabilities",
    describeRoute({
      summary: "Register a MANUAL capability (verified:false)",
      tags: ["Admin Knowledge"],
      responses: {
        200: { description: "Upserted — {capability, created}" },
        400: { description: "Validation/idempotency-key failure" },
      },
    }),
    async (c) => {
      const actorRef = getPrincipal(c)!.id;
      const body = capBodySchema.safeParse(await c.req.json().catch(() => null));
      if (!body.success) {
        return errorResponse(c, 400, ErrorCodes.INVALID_INPUT, "bad capability body");
      }
      return runKnowledgeWrite(
        c,
        "POST:/admin/api/knowledge/capabilities",
        async () => {
          const r = await upsertKnowledgeCapability(store, {
            name: body.data.name,
            kind: body.data.kind,
            description: body.data.description ?? null,
            source: "MANUAL",
          });
          if (!r.ok) {
            return { status: 400, body: errBody(r.error.toUpperCase()) };
          }
          // Arc R1 M3: `created` comes from the store's xmax check —
          // the old re-read compared createdAt to itself (always true).
          return {
            status: 200,
            body: { capability: r.capability, created: r.created },
          };
        },
        { owner: actorRef, fingerprint: requestFingerprint(body.data) },
      );
    },
  );

  for (const unlink of [false, true] as const) {
    app.post(
      `/admin/api/knowledge/items/:id/capabilities${unlink ? "/unlink" : ""}`,
        describeRoute({
        summary: unlink ? "Unlink a capability from an item" : "Link a capability to an item",
        tags: ["Admin Knowledge"],
        responses: {
          200: { description: unlink ? "{removed}" : "{created}" },
          400: { description: "Validation/idempotency-key failure" },
          404: { description: "Unknown item/capability" },
        },
      }),
      async (c) => {
        const itemId = c.req.param("id") ?? "";
        const ctrlBad = rejectCtrl(c, itemId);
        if (ctrlBad) return ctrlBad;
        const actorRef = getPrincipal(c)!.id;
        const body = linkBodySchema.safeParse(
          await c.req.json().catch(() => null),
        );
        if (!body.success) {
          return errorResponse(c, 400, ErrorCodes.INVALID_INPUT, "capabilityId required");
        }
        const capabilityId = body.data.capabilityId;
        return runKnowledgeWrite(
          c,
          `POST:/admin/api/knowledge/items/${itemId}/capabilities`,
          async () => {
            if (unlink) {
              const r = await unlinkItemCapability(store, itemId, capabilityId);
              if (!r.ok) return { status: 400, body: errBody(r.error.toUpperCase()) };
              return { status: 200, body: { removed: r.removed } };
            }
            const r = await linkItemCapability(store, itemId, capabilityId);
            if (!r.ok) {
              const status = r.error.endsWith("not_found") ? 404 : 400;
              return { status, body: errBody(r.error.toUpperCase()) };
            }
            return { status: 200, body: { created: r.created } };
          },
          {
            owner: actorRef,
            resource: `${itemId}:${capabilityId}:${unlink ? "unlink" : "link"}`,
            fingerprint: requestFingerprint({ ...body.data, unlink }),
          },
        );
      },
    );
  }
}
