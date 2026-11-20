/**
 * EPIC-228 (SLICE-228-4, D-228-5/6/8): admin interaction API —
 *   GET  /api/admin/interactions              → operator queue (FIFO)
 *   GET  /api/admin/interactions/:id          → full detail + session thread
 *   GET  /api/admin/interactions/:id/events   → full internal log (audit)
 *   POST /api/admin/interactions/:id/{classify,respond,reject}
 *     — mutations live in agent-interaction-admin-mutations.ts
 *       (300-line guard)
 *
 * All behind adminAuth. operatorRef = `X-Operator-Id` header claim
 * (fallback "admin") — self-declared inside the shared-key trust
 * boundary, never taken from the body (C55-review Q5 cross-check:
 * attribution can't be spoofed by the request payload itself).
 * Every mutation leaves an append-only event carrying operatorRef —
 * the AdminAction-style who/when trail.
 */

import { Hono } from "hono";
import type { Context } from "hono";
import { describeRoute } from "hono-openapi";

import { adminAuth } from "../../middleware/adminAuth";
import { errorResponse } from "../../lib/error-response";
import { ErrorCodes } from "../../lib/error-codes";
import type { RequestInboxStores } from "../../lib/request-inbox/store";
import type { InboxRequestRecord } from "../../lib/request-inbox/types";
import {
  statusOfState,
  type InteractionStatus,
} from "../../lib/request-inbox/interaction-types";
import { internalHistory } from "../../lib/agent-interaction";
import { registerInteractionMutationRoutes } from "./agent-interaction-admin-mutations";

const QUEUE_LIMIT_DEFAULT = 50;
const QUEUE_LIMIT_MAX = 200;
const EXCERPT_MAX = 200;

const STATUSES = new Set([
  "PENDING_REVIEW",
  "IN_REVIEW",
  "ANSWERED",
  "REJECTED",
]);

function excerptOf(record: InboxRequestRecord): string {
  const p = record.payload;
  if (p && typeof p === "object") {
    const text = (p as Record<string, unknown>).text;
    if (typeof text === "string") return text.slice(0, EXCERPT_MAX);
  }
  return "";
}

const notFound = (c: Context) =>
  errorResponse(c, 404, ErrorCodes.REQUEST_NOT_FOUND, "no such request");

export interface AgentInteractionAdminDeps {
  stores: RequestInboxStores;
}

export function createAgentInteractionAdminRoutes(
  deps: AgentInteractionAdminDeps,
): Hono {
  const app = new Hono();
  const { stores } = deps;

  app.get(
    "/api/admin/interactions",
    adminAuth,
    describeRoute({
      summary: "Operator queue — FIFO, default status PENDING_REVIEW",
      tags: ["Admin Interactions"],
      responses: { 200: { description: "Queue page + nextCursor" } },
    }),
    async (c) => {
      const statusParam = c.req.query("status") ?? "PENDING_REVIEW";
      let status: InteractionStatus | undefined;
      if (statusParam !== "all") {
        if (!STATUSES.has(statusParam)) {
          return errorResponse(
            c,
            400,
            ErrorCodes.INVALID_INPUT,
            `status must be one of ${[...STATUSES, "all"].join(", ")}`,
          );
        }
        status = statusParam as InteractionStatus;
      }
      const actorResolution = c.req.query("actorResolution");
      if (
        actorResolution !== undefined &&
        !["ANON", "API_KEY", "DID"].includes(actorResolution)
      ) {
        return errorResponse(
          c,
          400,
          ErrorCodes.INVALID_INPUT,
          "actorResolution must be ANON|API_KEY|DID",
        );
      }
      const limit = Math.min(
        Math.max(Number(c.req.query("limit")) || QUEUE_LIMIT_DEFAULT, 1),
        QUEUE_LIMIT_MAX,
      );
      const cursorRaw = c.req.query("cursor");
      const beforeMs = cursorRaw !== undefined ? Number(cursorRaw) : undefined;
      if (beforeMs !== undefined && !Number.isFinite(beforeMs)) {
        return errorResponse(
          c,
          400,
          ErrorCodes.INVALID_INPUT,
          "cursor must be a createdAtMs number",
        );
      }

      const rows = await stores.interactions.listQueue({
        status,
        actorResolution,
        limit: limit + 1,
        beforeMs,
      });
      const hasMore = rows.length > limit;
      const page = rows.slice(0, limit);
      return c.json({
        items: page.map((r) => ({
          id: r.id,
          status: statusOfState(r.state),
          actorResolution: r.actorResolution,
          intent: r.intent,
          excerpt: excerptOf(r),
          createdAt: new Date(r.createdAtMs).toISOString(),
        })),
        nextCursor: hasMore ? String(page[page.length - 1].createdAtMs) : null,
      });
    },
  );

  app.get(
    "/api/admin/interactions/:id",
    adminAuth,
    describeRoute({
      summary: "Full interaction detail — payload, classification, thread, events",
      tags: ["Admin Interactions"],
      responses: {
        200: { description: "internalHistory + session thread" },
        404: { description: "Unknown id" },
      },
    }),
    async (c) => {
      const h = await internalHistory(stores, c.req.param("id"));
      if (!h) return notFound(c);
      const thread = h.request.sessionId
        ? await stores.interactions.listBySession(h.request.sessionId)
        : [];
      const session = h.request.sessionId
        ? await stores.interactions.getSession(h.request.sessionId)
        : null;
      return c.json({
        request: {
          id: h.request.id,
          status: statusOfState(h.request.state),
          kind: h.request.kind,
          payload: h.request.payload,
          actorResolution: h.request.actorResolution,
          actorRef: h.request.actorRef,
          sessionId: h.request.sessionId,
          channel: h.request.channel,
          fingerprint: h.request.fingerprint,
          fpHash: h.request.fpHash,
          createdAt: new Date(h.request.createdAtMs).toISOString(),
          respondedAt: h.request.respondedAtMs
            ? new Date(h.request.respondedAtMs).toISOString()
            : null,
        },
        classification: h.classification,
        responses: h.responses,
        events: h.events,
        session,
        thread: thread.map((t) => ({
          id: t.id,
          status: statusOfState(t.state),
          kind: t.kind,
          excerpt: excerptOf(t),
          createdAt: new Date(t.createdAtMs).toISOString(),
        })),
      });
    },
  );

  app.get(
    "/api/admin/interactions/:id/events",
    adminAuth,
    describeRoute({
      summary: "Full internal event log — both visibilities (audit)",
      tags: ["Admin Interactions"],
      responses: {
        200: { description: "events[] + responses[]" },
        404: { description: "Unknown id" },
      },
    }),
    async (c) => {
      const id = c.req.param("id");
      const { record } = await stores.requests.get(id);
      if (!record) return notFound(c);
      const [events, responses] = await Promise.all([
        stores.interactions.listEvents(id),
        stores.interactions.listResponses(id),
      ]);
      return c.json({ id, events, responses });
    },
  );

  registerInteractionMutationRoutes(app, stores);
  return app;
}
