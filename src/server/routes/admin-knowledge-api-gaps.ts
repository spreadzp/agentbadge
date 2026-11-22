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
import type { KnowledgeStore } from "../lib/knowledge/store";
import {
  KNOWLEDGE_GAP_STATUSES,
  listGaps,
  resolveGap,
  triageGap,
  noControlChars,
  wontfixGap,
} from "../lib/knowledge";
import {
  rejectCtrl,
  requestFingerprint,
  requireOperatorRef,
  runKnowledgeWrite,
} from "./admin-operator-guard";

const resolveBodySchema = z.object({
  linkedItemId: z
    .string()
    .min(1)
    .refine(noControlChars, { message: "control characters not allowed" }),
});

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
        const gapId = c.req.param("id") ?? "";
        const ctrlBad = rejectCtrl(c, gapId);
        if (ctrlBad) return ctrlBad;
        const actorRef = requireOperatorRef(c);
        if (actorRef instanceof Response) return actorRef;
        // Body is parsed OUTSIDE the produce closure (Arc R1 H1):
        // the fingerprint must cover it before the key binds.
        const raw = action === "resolve"
          ? await c.req.json().catch(() => null)
          : null;
        const body =
          action === "resolve" ? resolveBodySchema.safeParse(raw) : null;
        if (body && !body.success) {
          return errorResponse(
            c,
            400,
            ErrorCodes.INVALID_INPUT,
            "linkedItemId required",
          );
        }
        return runKnowledgeWrite(
          c,
          `POST:/admin/api/knowledge/gaps/${gapId}/${action}`,
          async () => {
            if (action === "resolve" && body?.success) {
              const r = await resolveGap(
                store,
                gapId,
                body.data.linkedItemId,
                actorRef,
              );
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
                ? await triageGap(store, gapId, actorRef)
                : await wontfixGap(store, gapId, actorRef);
            if (!r.ok) {
              return {
                status: statusOf(r.error),
                body: errBody(r.error.toUpperCase()),
              };
            }
            return { status: 200, body: { gap: r.gap } };
          },
          {
            owner: actorRef,
            resource: `${gapId}:${action}`,
            fingerprint: requestFingerprint(body?.success ? body.data : {}),
          },
        );
      },
    );
  }
}
