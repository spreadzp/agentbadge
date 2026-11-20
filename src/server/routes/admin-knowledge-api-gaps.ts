/**
 * EPIC-229 (SLICE-229-8): admin knowledge-gap endpoints —
 *   GET  /admin/api/knowledge/gaps?status=&sort=
 *   POST /admin/api/knowledge/gaps/:id/triage
 *   POST /admin/api/knowledge/gaps/:id/resolve  {linkedItemId}
 *   POST /admin/api/knowledge/gaps/:id/wontfix
 *
 * Split out of admin-knowledge-api.ts (300-line guard). Writes need
 * idempotency-key; lifecycle CAS lives in lib/knowledge/gaps.ts —
 * the route maps honest {ok:false} to 400/404.
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
  KNOWLEDGE_GAP_STATUSES,
  listGaps,
  resolveGap,
  triageGap,
  wontfixGap,
} from "../lib/knowledge";
import { operatorRefOf } from "./agent-interaction/agent-interaction-admin-mutations";

const resolveBodySchema = z.object({ linkedItemId: z.string().min(1) });

const errBody = (error: string) => ({ error: { code: error, message: error } });
const statusOf = (error: string) =>
  error === "not_found" || error === "linked_item_missing" ? 404 : 400;

export function registerKnowledgeGapRoutes(
  app: Hono,
  store: KnowledgeStore,
): void {
  app.get(
    "/admin/api/knowledge/gaps",
    adminAuth,
    describeRoute({
      summary: "List knowledge gaps — deduped agent-signal backlog",
      tags: ["Admin Knowledge"],
      responses: { 200: { description: "{gaps[], count}" } },
    }),
    async (c) => {
      const status = c.req.query("status");
      if (
        status !== undefined &&
        !KNOWLEDGE_GAP_STATUSES.includes(status as never)
      ) {
        return errorResponse(c, 400, ErrorCodes.INVALID_INPUT, "bad status");
      }
      const sort = c.req.query("sort");
      const rows = await listGaps(store, {
        status,
        sort: sort === "lastSeen" ? "lastSeen" : "count",
      });
      return c.json({ gaps: rows, count: rows.length });
    },
  );

  for (const action of ["triage", "resolve", "wontfix"] as const) {
    app.post(
      `/admin/api/knowledge/gaps/:id/${action}`,
      adminAuth,
      describeRoute({
        summary: `Gap lifecycle: ${action}`,
        tags: ["Admin Knowledge"],
        responses: {
          200: { description: "{gap}" },
          400: { description: "Invalid transition / missing linked item" },
          404: { description: "Unknown gap" },
        },
      }),
      async (c) => {
        const key = readIdempotencyKey(c);
        if (key instanceof Response) return key;
        const gapId = c.req.param("id") ?? "";
        const actorRef = operatorRefOf(c);
        const res = await idempotentWrite(
          `POST:/admin/api/knowledge/gaps/${gapId}/${action}`,
          key,
          async () => {
            if (action === "resolve") {
              const body = resolveBodySchema.safeParse(
                await c.req.json().catch(() => null),
              );
              if (!body.success) {
                return {
                  status: 400,
                  body: errBody("LINKED_ITEM_ID_REQUIRED"),
                };
              }
              const r = await resolveGap(store, gapId, body.data.linkedItemId);
              if (!r.ok) {
                return {
                  status: statusOf(r.error),
                  body: errBody(r.error.toUpperCase()),
                };
              }
              return { status: 200, body: { gap: r.gap } };
            }
            const r =
              action === "triage"
                ? await triageGap(store, gapId)
                : await wontfixGap(store, gapId);
            if (!r.ok) {
              return {
                status: statusOf(r.error),
                body: errBody(r.error.toUpperCase()),
              };
            }
            return { status: 200, body: { gap: r.gap } };
          },
          { owner: actorRef, resource: `${gapId}:${action}` },
        );
        return c.json(res.body, res.status as 200);
      },
    );
  }
}
