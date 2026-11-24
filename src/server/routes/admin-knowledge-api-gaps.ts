/**
 * EPIC-229 (SLICE-229-8): admin knowledge-gap endpoints —
 *   GET  /admin/api/knowledge/gaps?status=&sort=&assigned=
 *   GET  /admin/api/knowledge/gaps/:id/events   (264-11 audit trail)
 *   POST /admin/api/knowledge/gaps/:id/triage
 *   POST /admin/api/knowledge/gaps/:id/resolve  {linkedItemId}
 *   POST /admin/api/knowledge/gaps/:id/wontfix
 *   POST /admin/api/knowledge/gaps/:id/assign   {assignedTo, dueAt?}    (264-12)
 *   POST /admin/api/knowledge/gaps/:id/unassign                        (264-12)
 *   POST /admin/api/knowledge/gaps/:id/due      {dueAt|null, reason}   (264-12)
 *
 * Split out of admin-knowledge-api.ts (300-line guard). Writes need
 * idempotency-key; lifecycle CAS lives in lib/knowledge/gaps.ts —
 * the route maps honest {ok:false} to 400/404/409.
 */

import type { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { z } from "zod";

import { errorResponse } from "../lib/error-response";
import { ErrorCodes } from "../lib/error-codes";
import { principalId } from "../middleware/operatorAuth";
import type { KnowledgeStore } from "../lib/knowledge/store";
import type { OperatorStore } from "../lib/operators/store";
import {
  KNOWLEDGE_GAP_STATUSES,
  listGaps,
  resolveGap,
  triageGap,
  noCtrlStrict,
  wontfixGap,
} from "../lib/knowledge";
import {
  rejectCtrl,
  requestFingerprint,
  runKnowledgeWrite,
} from "./admin-operator-guard";
import { registerKnowledgeGapOwnershipRoutes } from "./admin-knowledge-api-gaps-ownership";

const resolveBodySchema = z.object({
  linkedItemId: z
    .string()
    .min(1)
    .refine(noCtrlStrict, { message: "control characters not allowed" }),
});

export const errBody = (error: string) => ({
  error: { code: error, message: error },
});
export const statusOf = (error: string) =>
  error === "not_found" || error === "linked_item_missing"
    ? 404
    : error === "already_assigned" || error === "gap_terminal"
      ? 409
      : 400;

export function registerKnowledgeGapRoutes(
  app: Hono,
  store: KnowledgeStore,
  operators: OperatorStore,
): void {
  app.get(
    "/admin/api/knowledge/gaps",
    describeRoute({
      summary: "List knowledge gaps — deduped agent-signal backlog",
      tags: ["Admin Knowledge"],
      responses: { 200: { description: "{gaps[], count}" } },
    }),
    async (c) => {
      const status = c.req.query("status");
      if (
        status !== undefined &&
        status !== "all" &&
        !KNOWLEDGE_GAP_STATUSES.includes(status as never)
      ) {
        return errorResponse(c, 400, ErrorCodes.INVALID_INPUT, "bad status");
      }
      const sort = c.req.query("sort");
      // Arc R4 M-9: paging params — floor to int (a fractional
      // ?offset=1.5 used to bind a non-integer to the int4 param and
      // 500 on PG), clamp to sane bounds.
      const int = (raw: string | undefined, dflt: number, max: number) => {
        const n = Math.floor(Number(raw ?? dflt));
        return Number.isFinite(n) && n >= 0 ? Math.min(n, max) : dflt;
      };
      const limit = int(c.req.query("limit"), 100, 500);
      const offset = int(c.req.query("offset"), 0, 1_000_000);
      const rows = await listGaps(store, {
        status: status === "all" ? undefined : status,
        sort:
          sort === "lastSeen" || sort === "overdue" ? sort : "count",
        // 264-12: ?assigned=none — the unassigned pick-up pool.
        unassigned: c.req.query("assigned") === "none",
        limit,
        offset,
      });
      return c.json({ gaps: rows, count: rows.length, limit, offset });
    },
  );

  // 264-11: persisted audit trail — append-only rows written in
  // the same tx as every ownership/lifecycle mutation.
  app.get(
    "/admin/api/knowledge/gaps/:id/events",
    describeRoute({
      summary: "Gap audit trail — persisted ownership/lifecycle events",
      tags: ["Admin Knowledge"],
      responses: {
        200: { description: "{events[], count}" },
        404: { description: "Unknown gap" },
      },
    }),
    async (c) => {
      const gapId = c.req.param("id") ?? "";
      const ctrlBad = rejectCtrl(c, gapId);
      if (ctrlBad) return ctrlBad;
      const gap = await store.getGap(gapId);
      if (!gap) {
        return errorResponse(
          c,
          404,
          ErrorCodes.RESOURCE_NOT_FOUND,
          "gap not found",
        );
      }
      const events = await store.listGapEvents(gapId);
      return c.json({ events, count: events.length });
    },
  );

  for (const action of ["triage", "resolve", "wontfix"] as const) {
    app.post(
      `/admin/api/knowledge/gaps/:id/${action}`,
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
        const actorRef = principalId(c);
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

  // 264-12: /assign + /unassign + /due — ownership write path lives
  // in the sibling file (300-line cap).
  registerKnowledgeGapOwnershipRoutes(app, store, operators);
}
